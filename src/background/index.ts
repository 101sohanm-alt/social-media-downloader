import { ExtractedMediaItem } from '../shared/types';
import {
  getSettings,
  saveSettings,
  getHistory,
  clearHistory,
  downloadMediaItem
} from './downloadManager';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'DOWNLOAD_MEDIA') {
    (async () => {
      const items = (message.items as ExtractedMediaItem[]) || [];
      if (items.length === 0) {
        sendResponse({ success: false, error: 'No media items specified' });
        return;
      }

      const settings = await getSettings();
      const toDownload = (message.forceAll || message.explicit)
        ? items
        : (settings.autoDownloadAllCarousel ? items : [items[0]]);

      let successCount = 0;
      for (const item of toDownload) {
        const ok = await downloadMediaItem(item, settings);
        if (ok) successCount++;
        // Short delay between multi-downloads
        if (toDownload.length > 1) {
          await new Promise((r) => setTimeout(r, 250));
        }
      }

      sendResponse({
        success: successCount > 0,
        total: toDownload.length,
        succeeded: successCount
      });
    })();
    return true; // Keep channel open
  }

  if (message.action === 'GET_SETTINGS') {
    getSettings().then((settings) => sendResponse({ success: true, settings }));
    return true;
  }

  if (message.action === 'SAVE_SETTINGS') {
    saveSettings(message.settings).then((settings) => sendResponse({ success: true, settings }));
    return true;
  }

  if (message.action === 'GET_HISTORY') {
    getHistory().then((history) => sendResponse({ success: true, history }));
    return true;
  }

  if (message.action === 'CLEAR_HISTORY') {
    clearHistory().then(() => sendResponse({ success: true }));
    return true;
  }
});
