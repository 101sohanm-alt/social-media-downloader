import { ExtractedMediaItem, UserSettings, DownloadHistoryItem } from '../shared/types';
import { formatFilename } from '../shared/filename';
import {
  hostAvailable,
  downloadViaHost,
  muxViaHost,
  setFolder,
  resetHostAvailability
} from './nativeHost';

const DEFAULT_SETTINGS: UserSettings = {
  subfolder: 'SocialDownloads',
  nativeFolder: null,
  filenameTemplate: '{platform}_{author}_{id}_{index}',
  autoDownloadAllCarousel: true
};

/**
 * Bounded settle window before re-reading a freshly-started download. Chrome
 * reports an immediate 403/expired-URL interruption well inside this.
 */
const DOWNLOAD_VERIFY_DELAY_MS = 400;

export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
}

export async function saveSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  await chrome.storage.local.set({ settings: updated });
  return updated;
}

export async function getHistory(): Promise<DownloadHistoryItem[]> {
  const result = await chrome.storage.local.get('downloadHistory');
  return (result.downloadHistory as DownloadHistoryItem[]) || [];
}

export async function recordHistory(item: DownloadHistoryItem): Promise<void> {
  const history = await getHistory();
  const updated = [item, ...history].slice(0, 50); // Keep last 50
  await chrome.storage.local.set({ downloadHistory: updated });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.set({ downloadHistory: [] });
}

let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL('offscreen/offscreen.html');
  const existingContexts = await (chrome.runtime as any).getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: 'Muxing audio and video streams'
  });

  await creatingOffscreen;
  creatingOffscreen = null;
}

async function fetchAsDataUrl(url: string, defaultMime: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  const base64 = btoa(binary);
  const mimeType = response.headers.get('content-type') || defaultMime;
  return `data:${mimeType};base64,${base64}`;
}

/**
 * A blank (or whitespace-only) subfolder means ~/Downloads itself — never a
 * path like " /file.jpg". Leading/trailing slashes are stripped so the result
 * is always relative, as `chrome.downloads` requires.
 */
function buildDownloadPath(subfolder: string | null | undefined, filename: string): string {
  const clean = (subfolder || '').trim().replace(/^[/\\]+|[/\\]+$/g, '');
  return clean ? `${clean}/${filename}` : filename;
}

/**
 * `chrome.downloads.download()` resolves when the download *starts*. Catch the
 * common failure mode (expired/403 CDN URL) with one delayed re-read: an
 * `interrupted` entry means no file was produced, so the history row must say
 * `failed` rather than `completed`.
 *
 * This only ever rejects a provable failure — a still-`in_progress` item, a
 * missing item, or an unavailable API all count as "started".
 */
async function verifyDownloadStarted(downloadId: number): Promise<boolean> {
  const downloads = chrome.downloads;
  if (!downloads || typeof downloads.search !== 'function') return true;

  await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_VERIFY_DELAY_MS));

  try {
    const [item] = await downloads.search({ id: downloadId });
    if (!item) return true;
    if (item.state === 'interrupted' || item.error) return false;
    return true;
  } catch {
    // Verification is advisory only; never fail a download because the
    // follow-up query failed.
    return true;
  }
}

function buildFilename(item: ExtractedMediaItem, settings: UserSettings): string {
  return formatFilename(settings.filenameTemplate, {
    platform: item.platform,
    author: item.author || 'unknown',
    id: item.id,
    title: item.title,
    index: item.index,
    total: item.total,
    ext: item.ext
  });
}

type NativeAttempt =
  | { kind: 'record'; record: DownloadHistoryItem }
  | { kind: 'unusable' } // host absent / blocked — fall back to chrome.downloads
  | { kind: 'failed'; message: string }; // host ran but the transfer failed

/**
 * Download through the native host when it is installed and a folder has been
 * chosen. `unusable` means nothing was written and the `chrome.downloads` path
 * should be used instead; `failed` means the host was reachable but could not
 * complete the transfer (no silent switch of destination folder).
 */
async function tryNativeDownload(
  item: ExtractedMediaItem,
  settings: UserSettings,
  filename: string
): Promise<NativeAttempt> {
  const folder = (settings.nativeFolder || '').trim();
  if (!folder) return { kind: 'unusable' };
  if (!(await hostAvailable())) return { kind: 'unusable' };

  // The host is stateless between `sendNativeMessage` calls, so it may have
  // forgotten the folder (fresh process, reinstall, or a state file it lost).
  // Re-assert the chosen destination before every transfer; `download` and
  // `mux` must never land somewhere the user did not pick.
  const applied = await setFolder(folder);
  if (!applied.ok) {
    if (applied.code === 'unavailable' || applied.code === 'forbidden') {
      resetHostAvailability();
      return { kind: 'unusable' };
    }
    return { kind: 'failed', message: applied.message };
  }

  const useMux = !!(item.isDashMuxRequired && item.platform === 'reddit' && item.audioUrl);

  const result = useMux
    ? await muxViaHost(item.url, item.audioUrl as string, filename)
    : await downloadViaHost(item.url, filename);

  if (!result.ok) {
    // A host that vanished or is blocked must not wedge the download: fall
    // back to the browser path. Any other failure is reported as a failure.
    if (result.code === 'unavailable' || result.code === 'forbidden') {
      resetHostAvailability();
      return { kind: 'unusable' };
    }
    return { kind: 'failed', message: result.message };
  }

  return {
    kind: 'record',
    record: {
      id: result.value.path,
      platform: item.platform,
      author: item.author || 'unknown',
      filename,
      timestamp: Date.now(),
      status: 'completed'
    }
  };
}

export async function downloadMediaItem(item: ExtractedMediaItem, settings: UserSettings): Promise<boolean> {
  try {
    const filename = buildFilename(item, settings);

    // Native host path (preferred when configured and reachable).
    const nativeAttempt = await tryNativeDownload(item, settings, filename);
    if (nativeAttempt.kind === 'record') {
      await recordHistory(nativeAttempt.record);
      return true;
    }
    if (nativeAttempt.kind === 'failed') {
      throw new Error(nativeAttempt.message);
    }

    // ---- chrome.downloads path (also the fallback when the host is absent) ----
    let downloadUrl = item.url;

    // Handle Reddit DASH muxing
    if (item.isDashMuxRequired && item.platform === 'reddit') {
      try {
        await ensureOffscreenDocument();
        const muxResponse: any = await chrome.runtime.sendMessage({
          action: 'MUX_REDDIT_DASH',
          videoUrl: item.url,
          audioUrl: item.audioUrl
        });

        if (muxResponse?.success && muxResponse.dataUrl) {
          downloadUrl = muxResponse.dataUrl;
        }
      } catch {
        // Fallback to direct video URL if muxing fails
        downloadUrl = item.url;
      }
    }

    const targetPath = buildDownloadPath(settings.subfolder, filename);

    let downloadId: number | undefined;
    try {
      downloadId = await chrome.downloads.download({
        url: downloadUrl,
        filename: targetPath,
        saveAs: false,
        conflictAction: 'uniquify'
      });
    } catch (directErr) {
      // Fallback: fetch directly using extension background permissions and convert to Data URL (SW safe)
      try {
        const defaultMime = item.type === 'video' ? 'video/mp4' : 'image/jpeg';
        const dataUrl = await fetchAsDataUrl(downloadUrl, defaultMime);
        downloadId = await chrome.downloads.download({
          url: dataUrl,
          filename: targetPath,
          saveAs: false,
          conflictAction: 'uniquify'
        });
      } catch (fallbackErr) {
        throw directErr || fallbackErr;
      }
    }

    if (downloadId === undefined || downloadId === null) {
      throw new Error('chrome.downloads.download() returned no download id');
    }

    // A download that was interrupted straight away produced no file — record
    // it as failed instead of the old unconditional "completed".
    if (!(await verifyDownloadStarted(downloadId))) {
      throw new Error('Download was interrupted before completion');
    }

    await recordHistory({
      id: String(downloadId || Date.now()),
      platform: item.platform,
      author: item.author || 'unknown',
      filename,
      timestamp: Date.now(),
      status: 'completed'
    });

    return true;
  } catch (err) {
    await recordHistory({
      id: String(Date.now()),
      platform: item.platform,
      author: item.author || 'unknown',
      filename: item.url,
      timestamp: Date.now(),
      status: 'failed'
    });
    return false;
  }
}
