import { ExtractedMediaItem, UserSettings, DownloadHistoryItem } from '../shared/types';
import { formatFilename } from '../shared/filename';

const DEFAULT_SETTINGS: UserSettings = {
  subfolder: 'SocialDownloads',
  filenameTemplate: '{platform}_{author}_{id}_{index}',
  autoDownloadAllCarousel: true
};

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

export async function downloadMediaItem(item: ExtractedMediaItem, settings: UserSettings): Promise<boolean> {
  try {
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

    const filename = formatFilename(settings.filenameTemplate, {
      platform: item.platform,
      author: item.author || 'unknown',
      id: item.id,
      title: item.title,
      index: item.index,
      total: item.total,
      ext: item.ext
    });

    const targetPath = settings.subfolder ? `${settings.subfolder}/${filename}` : filename;

    const downloadId = await chrome.downloads.download({
      url: downloadUrl,
      filename: targetPath,
      saveAs: false
    });

    await recordHistory({
      id: String(downloadId),
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
