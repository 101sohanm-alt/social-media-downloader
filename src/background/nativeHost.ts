/**
 * Typed client for the Omni Media native messaging host.
 *
 * Chrome spawns a fresh host process for every `sendNativeMessage` call, so the
 * host is stateless between calls: settings live in `chrome.storage` (extension
 * side) and the host is told the destination folder on each download.
 *
 * Media never crosses the bridge (1 MB message cap). The host writes files to
 * disk itself and returns a receipt.
 *
 * Every call resolves — never throws — with a discriminated result so callers
 * can fall back cleanly:
 *   { ok: true, value } | { ok: false, code, message }
 */
import { NATIVE_HOST_NAME } from '../shared/constants';

/** Control calls (ping/folder) are interactive; 30 s is generous. */
export const CONTROL_TIMEOUT_MS = 30_000;

/**
 * Transfers must finish inside Chrome's limit, not the other way round.
 *
 * The docs are explicit: a service worker is terminated "when a single request,
 * such as an event or API call, takes longer than 5 minutes to process"
 * (developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
 * A 15-minute transfer budget therefore guaranteed silent death on any large
 * file. 4 minutes leaves headroom for the response to be delivered before the
 * worker is torn down, and the host's own curl deadline is set below this so the
 * host always reports its failure rather than being killed mid-flight.
 */
export const TRANSFER_TIMEOUT_MS = 4 * 60_000;

/** Cache the ping so a 10-slide carousel does not spawn 10 host processes. */
export const AVAILABILITY_TTL_MS = 60_000;

export type NativeErrorCode =
  | 'unavailable' // host not installed / failed to start / exited
  | 'forbidden' // Chrome policy blocked the host
  | 'cancelled' // user dismissed the native folder picker
  | 'timeout' // host accepted the message but never answered
  | 'malformed' // host answered with something outside the contract
  | 'error'; // host answered { ok: false, error: "..." }

export type HostResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: NativeErrorCode; message: string };

export interface HostPing {
  version: string;
  platform: string;
}

export interface HostFolder {
  path: string | null;
}

export interface HostReceipt {
  path: string;
  bytes: number;
}

export type HostCommand =
  | { cmd: 'ping' }
  | { cmd: 'choose_folder'; prompt?: string }
  | { cmd: 'get_folder' }
  | { cmd: 'set_folder'; path: string }
  | { cmd: 'download'; url: string; filename: string }
  | { cmd: 'mux'; video_url: string; audio_url: string; filename: string };

function fail<T>(code: NativeErrorCode, message: string): HostResult<T> {
  return { ok: false, code, message };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Chrome reports native-messaging failures through `runtime.lastError` rather
 * than a rejected promise (callback form). Map the well-known strings onto
 * codes the UI can act on.
 */
function classifyRuntimeError(message: string): NativeErrorCode {
  const m = message.toLowerCase();
  if (m.includes('forbidden')) return 'forbidden';
  if (
    m.includes('host not found') ||
    m.includes('failed to start native messaging host') ||
    m.includes('native host has exited') ||
    m.includes('not available')
  ) {
    return 'unavailable';
  }
  return 'error';
}

type HostPayload = Record<string, unknown>;

/**
 * Normalise `{ok: boolean, ...}` into a HostResult. Treats a JSON string reply
 * as JSON (Chrome normally parses it already) and rejects anything that is not
 * a plain object with a boolean `ok`.
 */
function interpretPayload(raw: unknown): HostResult<HostPayload> {
  let payload = raw;

  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return fail('malformed', 'Native host returned a non-JSON string.');
    }
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail('malformed', 'Native host returned a non-object response.');
  }

  const record = payload as HostPayload;

  if (typeof record.ok !== 'boolean') {
    return fail('malformed', 'Native host response is missing the "ok" flag.');
  }

  if (record.ok === false) {
    const reason = typeof record.error === 'string' && record.error ? record.error : 'unknown error';
    if (reason.toLowerCase() === 'cancelled' || reason.toLowerCase() === 'canceled') {
      return fail('cancelled', 'Folder selection was cancelled.');
    }
    return fail('error', reason);
  }

  return { ok: true, value: record };
}

/**
 * Send one command to the host with a hard deadline. Resolves on response,
 * runtime error, synchronous throw, or timeout — whichever happens first.
 * A late response after a timeout is ignored.
 */
function sendCommand(command: HostCommand, timeoutMs: number): Promise<HostResult<HostPayload>> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: HostResult<HostPayload>) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };

    const runtime = typeof chrome !== 'undefined' ? chrome.runtime : undefined;
    if (!runtime || typeof runtime.sendNativeMessage !== 'function') {
      finish(fail('unavailable', 'Native messaging is not available in this context.'));
      return;
    }

    timer = setTimeout(() => {
      finish(
        fail(
          'timeout',
          `Native host did not answer "${command.cmd}" within ${Math.round(timeoutMs / 1000)}s.`
        )
      );
    }, timeoutMs);

    try {
      runtime.sendNativeMessage(NATIVE_HOST_NAME, command as unknown as object, (response: unknown) => {
        const lastError = runtime.lastError;
        if (lastError) {
          const message = lastError.message || `Native host error during "${command.cmd}".`;
          finish(fail(classifyRuntimeError(message), message));
          return;
        }
        finish(interpretPayload(response));
      });
    } catch (err) {
      const message = errorMessage(err);
      finish(fail(classifyRuntimeError(message), message));
    }
  });
}

// ---------------------------------------------------------------------------
// Availability cache
// ---------------------------------------------------------------------------

let availability: { value: boolean; at: number } | null = null;
let pendingPing: Promise<boolean> | null = null;

/** Forget the cached ping (tests, and after a host call reports `unavailable`). */
export function resetHostAvailability(): void {
  availability = null;
  pendingPing = null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function pingHost(): Promise<HostResult<HostPing>> {
  const res = await sendCommand({ cmd: 'ping' }, CONTROL_TIMEOUT_MS);
  if (!res.ok) return res;

  const { version, platform } = res.value;
  if (typeof version !== 'string' || !version) {
    return fail('malformed', 'Native host ping is missing "version".');
  }
  return {
    ok: true,
    value: {
      version,
      platform: typeof platform === 'string' ? platform : 'unknown'
    }
  };
}

/**
 * True when the host answers a ping. Cached for AVAILABILITY_TTL_MS so a batch
 * download does not spawn one process per item.
 */
export async function hostAvailable(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && availability && now - availability.at < AVAILABILITY_TTL_MS) {
    return availability.value;
  }
  if (!force && pendingPing) return pendingPing;

  pendingPing = pingHost()
    .then((res) => {
      availability = { value: res.ok, at: Date.now() };
      return res.ok;
    })
    .finally(() => {
      pendingPing = null;
    });

  return pendingPing;
}

export async function chooseFolder(prompt?: string): Promise<HostResult<{ path: string }>> {
  const command: HostCommand = prompt ? { cmd: 'choose_folder', prompt } : { cmd: 'choose_folder' };
  const res = await sendCommand(command, CONTROL_TIMEOUT_MS);
  if (!res.ok) return res;

  const path = res.value.path;
  if (typeof path !== 'string' || !path) {
    return fail('malformed', 'Native host did not return a folder path.');
  }
  return { ok: true, value: { path } };
}

export async function getFolder(): Promise<HostResult<HostFolder>> {
  const res = await sendCommand({ cmd: 'get_folder' }, CONTROL_TIMEOUT_MS);
  if (!res.ok) return res;

  const raw = res.value.path;
  if (raw === undefined || raw === null) return { ok: true, value: { path: null } };
  if (typeof raw !== 'string' || !raw) {
    return fail('malformed', 'Native host returned an invalid folder path.');
  }
  return { ok: true, value: { path: raw } };
}

export async function setFolder(path: string): Promise<HostResult<{ path: string }>> {
  const trimmed = (path || '').trim();
  if (!trimmed) return fail('error', 'No folder path was supplied.');

  const res = await sendCommand({ cmd: 'set_folder', path: trimmed }, CONTROL_TIMEOUT_MS);
  if (!res.ok) return res;

  const echo = res.value.path;
  if (echo !== undefined && echo !== null && typeof echo !== 'string') {
    return fail('malformed', 'Native host returned an invalid folder path.');
  }
  return { ok: true, value: { path: typeof echo === 'string' && echo ? echo : trimmed } };
}

function interpretReceipt(res: HostResult<HostPayload>): HostResult<HostReceipt> {
  if (!res.ok) return res;

  const path = res.value.path;
  if (typeof path !== 'string' || !path) {
    return fail('malformed', 'Native host receipt is missing the written file path.');
  }

  // `bytes` is informational; a file that exists is proof of success, so a
  // missing/odd byte count must not turn a real download into a failure.
  const bytes =
    typeof res.value.bytes === 'number' && Number.isFinite(res.value.bytes)
      ? res.value.bytes
      : 0;

  return { ok: true, value: { path, bytes } };
}

export async function downloadViaHost(
  url: string,
  filename: string
): Promise<HostResult<HostReceipt>> {
  if (!url) return fail('error', 'No download URL was supplied.');
  const res = await sendCommand({ cmd: 'download', url, filename }, TRANSFER_TIMEOUT_MS);
  return interpretReceipt(res);
}

export async function muxViaHost(
  videoUrl: string,
  audioUrl: string,
  filename: string
): Promise<HostResult<HostReceipt>> {
  if (!videoUrl || !audioUrl) return fail('error', 'Muxing needs both a video and an audio URL.');
  const res = await sendCommand(
    { cmd: 'mux', video_url: videoUrl, audio_url: audioUrl, filename },
    TRANSFER_TIMEOUT_MS
  );
  return interpretReceipt(res);
}
