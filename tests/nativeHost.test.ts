import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  pingHost,
  hostAvailable,
  resetHostAvailability,
  chooseFolder,
  getFolder,
  setFolder,
  downloadViaHost,
  muxViaHost,
  CONTROL_TIMEOUT_MS,
  TRANSFER_TIMEOUT_MS,
} from '../src/background/nativeHost';
import { downloadMediaItem, getSettings, getHistory, saveSettings } from '../src/background/downloadManager';
import { NATIVE_HOST_NAME } from '../src/shared/constants';
import { ExtractedMediaItem, UserSettings } from '../src/shared/types';

type NativeResponder = (message: Record<string, unknown>) => unknown;

let lastSent: Record<string, unknown> | null = null;
let responder: NativeResponder;

function installChromeMock() {
  const storage: Record<string, unknown> = {};

  const runtime: any = {
    lastError: undefined as { message: string } | undefined,
    getURL: (p: string) => `chrome-extension://test/${p}`,
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
    getContexts: vi.fn().mockResolvedValue([]),
    sendNativeMessage: vi.fn(
      (host: string, message: Record<string, unknown>, cb: (response: unknown) => void) => {
        lastSent = message;
        if (!responder) return; // hung host — never call back
        // Respond asynchronously, like the real API.
        Promise.resolve()
          .then(() => responder(message))
          .then(
            (response) => {
              // The real API sets lastError for failures and passes no response.
              if (response instanceof NativeFailure) {
                runtime.lastError = { message: response.message };
                cb(undefined);
                runtime.lastError = undefined;
              } else {
                cb(response);
              }
            },
            () => {
              runtime.lastError = { message: 'Native host has exited.' };
              cb(undefined);
              runtime.lastError = undefined;
            }
          );
      }
    ),
  };

  const downloads = {
    download: vi.fn().mockResolvedValue(41),
    search: vi.fn().mockResolvedValue([{ id: 41, state: 'complete' }]),
  };

  (globalThis as any).chrome = {
    runtime,
    downloads,
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in storage ? { [key]: storage[key] } : {})),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          Object.assign(storage, patch);
        }),
      },
    },
    offscreen: {
      Reason: { BLOBS: 'BLOBS' },
      createDocument: vi.fn().mockResolvedValue(undefined),
    },
  };

  return { runtime, downloads, storage };
}

/** Marker: the mock turns this into a Chrome `lastError` and an empty response. */
class NativeFailure {
  constructor(public message: string) {}
}

const settingsWithHost: UserSettings = {
  subfolder: 'SocialDownloads',
  nativeFolder: '/Users/me/Movies/Omni',
  filenameTemplate: '{platform}_{author}_{id}_{index}',
  autoDownloadAllCarousel: true,
};

const imageItem: ExtractedMediaItem = {
  id: 'abc123',
  platform: 'instagram',
  type: 'image',
  url: 'https://cdn.example.com/a.jpg',
  ext: '.jpg',
  author: 'creator',
};

let ctx: ReturnType<typeof installChromeMock>;

beforeEach(() => {
  ctx = installChromeMock();
  resetHostAvailability();
  lastSent = null;
  responder = () => ({ ok: true, version: '0.1.0', platform: 'macos' });
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as any).chrome;
});

// ---------------------------------------------------------------------------
// Contract: control commands
// ---------------------------------------------------------------------------

describe('nativeHost — success paths', () => {
  it('pings the host and sends the documented command on the documented host name', async () => {
    const res = await pingHost();

    expect(res).toEqual({ ok: true, value: { version: '0.1.0', platform: 'macos' } });
    expect(ctx.runtime.sendNativeMessage).toHaveBeenCalledTimes(1);
    expect(ctx.runtime.sendNativeMessage.mock.calls[0][0]).toBe(NATIVE_HOST_NAME);
    expect(lastSent).toEqual({ cmd: 'ping' });
    expect(NATIVE_HOST_NAME).toBe('com.omni.media.downloader');
  });

  it('chooseFolder returns the chosen path', async () => {
    responder = () => ({ ok: true, path: '/Users/me/Movies/Omni' });

    const res = await chooseFolder('Pick a folder');

    expect(res).toEqual({ ok: true, value: { path: '/Users/me/Movies/Omni' } });
    expect(lastSent).toEqual({ cmd: 'choose_folder', prompt: 'Pick a folder' });
  });

  it('chooseFolder omits the prompt key when none was supplied', async () => {
    responder = () => ({ ok: true, path: '/tmp/out' });

    await chooseFolder();

    expect(lastSent).toEqual({ cmd: 'choose_folder' });
  });

  it('getFolder maps a null path to null', async () => {
    responder = () => ({ ok: true, path: null });

    const res = await getFolder();

    expect(res).toEqual({ ok: true, value: { path: null } });
    expect(lastSent).toEqual({ cmd: 'get_folder' });
  });

  it('setFolder echoes the host path', async () => {
    responder = () => ({ ok: true, path: '/Users/me/Downloads/Omni' });

    const res = await setFolder('  /Users/me/Downloads/Omni  ');

    expect(res).toEqual({ ok: true, value: { path: '/Users/me/Downloads/Omni' } });
    expect(lastSent).toEqual({ cmd: 'set_folder', path: '/Users/me/Downloads/Omni' });
  });

  it('downloadViaHost returns the receipt and uses the transfer timeout', async () => {
    responder = () => ({ ok: true, path: '/Users/me/Movies/Omni/a.jpg', bytes: 2048 });

    const res = await downloadViaHost('https://cdn.example.com/a.jpg', 'a.jpg');

    expect(res).toEqual({
      ok: true,
      value: { path: '/Users/me/Movies/Omni/a.jpg', bytes: 2048 },
    });
    expect(lastSent).toEqual({
      cmd: 'download',
      url: 'https://cdn.example.com/a.jpg',
      filename: 'a.jpg',
    });
    expect(TRANSFER_TIMEOUT_MS).toBeGreaterThan(CONTROL_TIMEOUT_MS);
  });

  it('muxViaHost sends snake_case fields per the host contract', async () => {
    responder = () => ({ ok: true, path: '/out/v.mp4', bytes: 900 });

    const res = await muxViaHost('https://v.example.com/v.mp4', 'https://v.example.com/a.mp4', 'v.mp4');

    expect(res.ok).toBe(true);
    expect(lastSent).toEqual({
      cmd: 'mux',
      video_url: 'https://v.example.com/v.mp4',
      audio_url: 'https://v.example.com/a.mp4',
      filename: 'v.mp4',
    });
  });

  it('a receipt without a byte count still counts as success (file path is the proof)', async () => {
    responder = () => ({ ok: true, path: '/out/a.jpg' });

    const res = await downloadViaHost('https://cdn.example.com/a.jpg', 'a.jpg');

    expect(res).toEqual({ ok: true, value: { path: '/out/a.jpg', bytes: 0 } });
  });
});

// ---------------------------------------------------------------------------
// Contract: failure modes
// ---------------------------------------------------------------------------

describe('nativeHost — failure modes', () => {
  it('reports host-not-installed as unavailable', async () => {
    responder = () => new NativeFailure('Specified native messaging host not found.');

    const res = await pingHost();

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('unavailable');
    expect(res.message).toMatch(/not found/i);
  });

  it('reports a host that failed to start as unavailable', async () => {
    responder = () => new NativeFailure('Failed to start native messaging host.');

    const res = await pingHost();

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('unavailable');
  });

  it('reports a policy block as forbidden', async () => {
    responder = () => new NativeFailure('Access to the specified native messaging host is forbidden.');

    const res = await pingHost();

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('forbidden');
  });

  it('maps {"ok":false,"error":"cancelled"} to cancelled', async () => {
    responder = () => ({ ok: false, error: 'cancelled' });

    const res = await chooseFolder();

    expect(res).toEqual({
      ok: false,
      code: 'cancelled',
      message: 'Folder selection was cancelled.',
    });
  });

  it('surfaces other host errors verbatim', async () => {
    responder = () => ({ ok: false, error: 'disk full' });

    const res = await downloadViaHost('https://cdn.example.com/a.jpg', 'a.jpg');

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('error');
    expect(res.message).toBe('disk full');
  });

  it('does not resolve before the timeout, then reports timeout', async () => {
    vi.useFakeTimers();
    responder = () => undefined; // never call back — a hung host
    // Restore a hanging mock: our installer always calls back, so override it.
    ctx.runtime.sendNativeMessage.mockImplementation(() => {
      /* hang forever */
    });

    let settled = false;
    const promise = pingHost().then((r) => {
      settled = true;
      return r;
    });

    await vi.advanceTimersByTimeAsync(CONTROL_TIMEOUT_MS - 1000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);
    const res = await promise;

    expect(settled).toBe(true);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('timeout');
    expect(res.message).toContain('30s');
  });

  it('rejects a malformed ping (missing version) instead of reporting success', async () => {
    responder = () => ({ ok: true, platform: 'macos' });

    const res = await pingHost();

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('malformed');
  });

  it('rejects a non-object response', async () => {
    responder = () => 'not json at all';

    const res = await pingHost();

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('malformed');
  });

  it('rejects an object without an ok flag', async () => {
    responder = () => ({ path: '/tmp/x' });

    const res = await getFolder();

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('malformed');
  });

  it('accepts a JSON string reply (Chrome may hand one back unparsed)', async () => {
    responder = () => JSON.stringify({ ok: true, version: '9.9.9', platform: 'macos' });

    const res = await pingHost();

    expect(res).toEqual({ ok: true, value: { version: '9.9.9', platform: 'macos' } });
  });

  it('rejects a success reply with no folder path', async () => {
    responder = () => ({ ok: true });

    const res = await chooseFolder();

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('malformed');
  });

  it('handles a synchronous throw from the API as a classified error', async () => {
    ctx.runtime.sendNativeMessage.mockImplementation(() => {
      throw new Error('Specified native messaging host not found.');
    });

    const res = await pingHost();

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------
// Availability cache
// ---------------------------------------------------------------------------

describe('hostAvailable', () => {
  it('is true when the host pings and caches the result', async () => {
    expect(await hostAvailable()).toBe(true);
    expect(await hostAvailable()).toBe(true);
    // Second call served from cache — no extra host process.
    expect(ctx.runtime.sendNativeMessage).toHaveBeenCalledTimes(1);
  });

  it('is false when the host is missing', async () => {
    responder = () => new NativeFailure('Specified native messaging host not found.');

    expect(await hostAvailable()).toBe(false);
    expect(await hostAvailable()).toBe(false); // cached negative
    expect(ctx.runtime.sendNativeMessage).toHaveBeenCalledTimes(1);
  });

  it('re-probes when forced', async () => {
    await hostAvailable();
    await hostAvailable(true);
    expect(ctx.runtime.sendNativeMessage).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight ping between concurrent callers', async () => {
    const [a, b] = await Promise.all([hostAvailable(), hostAvailable()]);
    expect([a, b]).toEqual([true, true]);
    expect(ctx.runtime.sendNativeMessage).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// downloadManager — host path and downloads fallback
// ---------------------------------------------------------------------------

describe('downloadMediaItem — native host path', () => {
  /** The host is stateless: ping, then set_folder, then download/mux. */
  function scriptedHost(receipt: { path: string; bytes?: number }) {
    const seen: Record<string, unknown>[] = [];
    responder = (message) => {
      seen.push(message);
      if (message.cmd === 'ping') return { ok: true, version: '0.1.0', platform: 'macos' };
      if (message.cmd === 'set_folder') return { ok: true, path: message.path };
      return { ok: true, path: receipt.path, bytes: receipt.bytes ?? 10 };
    };
    return seen;
  }

  it('writes through the host when a folder is configured and the host is up', async () => {
    const seen = scriptedHost({ path: '/Users/me/Movies/Omni/instagram_creator_abc123.jpg', bytes: 10 });

    const ok = await downloadMediaItem(imageItem, settingsWithHost);

    expect(ok).toBe(true);
    expect(ctx.downloads.download).not.toHaveBeenCalled();

    // Ordering matters: the destination is re-asserted before the transfer.
    expect(seen.map((m) => m.cmd)).toEqual(['ping', 'set_folder', 'download']);
    expect(seen[1]).toEqual({ cmd: 'set_folder', path: '/Users/me/Movies/Omni' });
    expect(seen[2]).toEqual({
      cmd: 'download',
      url: 'https://cdn.example.com/a.jpg',
      filename: 'instagram_creator_abc123.jpg',
    });

    const history = await getHistory();
    expect(history[0].status).toBe('completed');
    expect(history[0].filename).toBe('instagram_creator_abc123.jpg');
  });

  it('muxes Reddit DASH through the host when audio is present', async () => {
    const seen = scriptedHost({ path: '/Users/me/Movies/Omni/reddit_v.mp4', bytes: 99 });

    const redditVideo: ExtractedMediaItem = {
      id: 'r1',
      platform: 'reddit',
      type: 'video',
      url: 'https://v.redd.it/x/DASH_720.mp4',
      audioUrl: 'https://v.redd.it/x/DASH_AUDIO_128.mp4',
      isDashMuxRequired: true,
      ext: '.mp4',
      author: 'redditor',
    };

    expect(await downloadMediaItem(redditVideo, settingsWithHost)).toBe(true);
    const transfer = seen.find((m) => m.cmd === 'mux');
    expect(transfer).toEqual({
      cmd: 'mux',
      video_url: 'https://v.redd.it/x/DASH_720.mp4',
      audio_url: 'https://v.redd.it/x/DASH_AUDIO_128.mp4',
      filename: 'reddit_redditor_r1.mp4',
    });
    // DASH never falls back to the browser path when the host handled it.
    expect(ctx.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('records the native receipt path as the history id', async () => {
    scriptedHost({ path: '/Users/me/Movies/Omni/file.jpg', bytes: 3 });

    await downloadMediaItem(imageItem, settingsWithHost);

    const history = await getHistory();
    expect(history[0].id).toBe('/Users/me/Movies/Omni/file.jpg');
  });

  it('fails (without writing elsewhere) when the host rejects the folder', async () => {
    responder = (message) => {
      if (message.cmd === 'ping') return { ok: true, version: '0.1.0', platform: 'macos' };
      if (message.cmd === 'set_folder') return { ok: false, error: 'permission denied' };
      return { ok: true, path: '/wrong/place.jpg' };
    };

    const ok = await downloadMediaItem(imageItem, settingsWithHost);

    expect(ok).toBe(false);
    // Destination not applied ⇒ never transfer, and never silently switch to ~/Downloads.
    expect(ctx.downloads.download).not.toHaveBeenCalled();
    const history = await getHistory();
    expect(history[0].status).toBe('failed');
  });

  it('records a timeout as pending, not failed — the host may still finish', async () => {
    // The host transfer runs in its own process. When our deadline elapses we
    // stop listening, but the host keeps downloading and may well write the file
    // afterwards. Calling that "failed" would paint a red row over a file that
    // exists, so the outcome must be recorded as unknown.
    vi.useFakeTimers();

    responder = (message) => {
      if (message.cmd === 'ping') return { ok: true, version: '0.1.0', platform: 'macos' };
      if (message.cmd === 'set_folder') return { ok: true, path: '/Users/me/Movies/Omni' };
      return { ok: true };
    };
    // The transfer itself never answers — a host still busy writing bytes.
    ctx.runtime.sendNativeMessage.mockImplementation(
      (_host: string, message: { cmd: string }, callback: (r: unknown) => void) => {
        if (message.cmd === 'download' || message.cmd === 'mux') return; // hang
        callback(responder(message));
      }
    );

    const promise = downloadMediaItem(imageItem, settingsWithHost);
    await vi.advanceTimersByTimeAsync(TRANSFER_TIMEOUT_MS + 1000);
    const ok = await promise;

    expect(ok).toBe(true);
    const history = await getHistory();
    expect(history[0].status).toBe('pending');
  });
});

describe('downloadMediaItem — chrome.downloads fallback', () => {
  it('falls back to chrome.downloads when the host is unavailable', async () => {
    responder = () => new NativeFailure('Specified native messaging host not found.');

    const ok = await downloadMediaItem(imageItem, settingsWithHost);

    expect(ok).toBe(true);
    expect(ctx.downloads.download).toHaveBeenCalledTimes(1);
    expect(ctx.downloads.download.mock.calls[0][0]).toMatchObject({
      url: 'https://cdn.example.com/a.jpg',
      filename: 'SocialDownloads/instagram_creator_abc123.jpg',
      saveAs: false,
      conflictAction: 'uniquify',
    });
  });

  it('uses chrome.downloads directly when no native folder is configured (no ping)', async () => {
    const ok = await downloadMediaItem(imageItem, { ...settingsWithHost, nativeFolder: null });

    expect(ok).toBe(true);
    expect(ctx.downloads.download).toHaveBeenCalledTimes(1);
    // No folder configured ⇒ the host is never contacted at all.
    expect(ctx.runtime.sendNativeMessage).not.toHaveBeenCalled();
  });

  it('keeps an existing subfolder working on the fallback path', async () => {
    responder = () => new NativeFailure('Specified native messaging host not found.');

    await downloadMediaItem(imageItem, { ...settingsWithHost, subfolder: 'OmniMedia/Instagram' });

    expect(ctx.downloads.download.mock.calls[0][0].filename).toBe(
      'OmniMedia/Instagram/instagram_creator_abc123.jpg'
    );
  });

  it('a blank subfolder produces a bare filename (no leading slash)', async () => {
    await downloadMediaItem(imageItem, { ...settingsWithHost, subfolder: '   ', nativeFolder: null });

    expect(ctx.downloads.download.mock.calls[0][0].filename).toBe('instagram_creator_abc123.jpg');
  });

  it('falls back when the host reports itself unavailable mid-transfer', async () => {
    let transfers = 0;
    responder = (message) => {
      if (message.cmd === 'ping') return { ok: true, version: '0.1.0', platform: 'macos' };
      if (message.cmd === 'set_folder') return { ok: true, path: message.path };
      transfers++;
      return new NativeFailure('Native host has exited.');
    };

    const ok = await downloadMediaItem(imageItem, settingsWithHost);

    expect(transfers).toBe(1);
    expect(ok).toBe(true);
    expect(ctx.downloads.download).toHaveBeenCalledTimes(1);
  });

  it('does not fall back when the host refuses the transfer for a real reason', async () => {
    responder = (message) => {
      if (message.cmd === 'ping') return { ok: true, version: '0.1.0', platform: 'macos' };
      if (message.cmd === 'set_folder') return { ok: true, path: message.path };
      return { ok: false, error: 'HTTP 403' };
    };

    const ok = await downloadMediaItem(imageItem, settingsWithHost);

    expect(ok).toBe(false);
    // A reachable host that tried and failed must not silently re-route to
    // ~/Downloads, which would leave the file somewhere the user never chose.
    expect(ctx.downloads.download).not.toHaveBeenCalled();
    const history = await getHistory();
    expect(history[0].status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// downloadManager — history status correctness (pre-existing bug)
// ---------------------------------------------------------------------------

describe('downloadMediaItem — history status', () => {
  it('records a failed download as failed, not completed', async () => {
    const original = ctx.downloads.download.getMockImplementation();
    ctx.downloads.download.mockRejectedValue(new Error('NETWORK_FAILED'));
    // The data-URL fallback also fails (fetch is unavailable in happy-dom).
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = vi.fn().mockRejectedValue(new Error('offline'));

    try {
      const ok = await downloadMediaItem(imageItem, { ...settingsWithHost, nativeFolder: null });

      expect(ok).toBe(false);
      const history = await getHistory();
      expect(history[0].status).toBe('failed');
    } finally {
      (globalThis as any).fetch = originalFetch;
      if (original) ctx.downloads.download.mockImplementation(original);
    }
  });

  it('records an immediately-interrupted download as failed', async () => {
    ctx.downloads.search.mockResolvedValue([
      { id: 41, state: 'interrupted', error: 'SERVER_FORBIDDEN' },
    ]);

    const ok = await downloadMediaItem(imageItem, { ...settingsWithHost, nativeFolder: null });

    expect(ok).toBe(false);
    const history = await getHistory();
    expect(history[0].status).toBe('failed');
  });

  it('records a still-downloading item as completed (download started successfully)', async () => {
    ctx.downloads.search.mockResolvedValue([{ id: 41, state: 'in_progress' }]);

    const ok = await downloadMediaItem(imageItem, { ...settingsWithHost, nativeFolder: null });

    expect(ok).toBe(true);
    const history = await getHistory();
    expect(history[0].status).toBe('completed');
  });

  it('still marks completed when the verification query is unavailable', async () => {
    // No search implementation at all.
    (ctx.downloads as any).search = undefined;

    const ok = await downloadMediaItem(imageItem, { ...settingsWithHost, nativeFolder: null });

    expect(ok).toBe(true);
    const history = await getHistory();
    expect(history[0].status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// Settings migration
// ---------------------------------------------------------------------------

describe('settings migration', () => {
  it('keeps a saved legacy subfolder and defaults nativeFolder to null', async () => {
    await chrome.storage.local.set({
      settings: {
        subfolder: 'OldFolder',
        filenameTemplate: '{platform}_{id}',
        autoDownloadAllCarousel: false,
      },
    });

    const settings = await getSettings();

    expect(settings.subfolder).toBe('OldFolder');
    expect(settings.nativeFolder).toBeNull();
  });

  it('persists a chosen native folder without dropping the subfolder', async () => {
    await saveSettings({ nativeFolder: '/Users/me/Movies/Omni' });

    const settings = await getSettings();

    expect(settings.nativeFolder).toBe('/Users/me/Movies/Omni');
    expect(settings.subfolder).toBe('SocialDownloads');
  });
});
