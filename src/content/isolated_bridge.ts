import { ExtractedMediaItem } from '../shared/types';
import { setupTwitterInjector } from './platforms/twitter';
import { setupInstagramInjector } from './platforms/instagram';
import { setupRedditInjector } from './platforms/reddit';

(function initIsolatedBridge() {
  const mediaCache = new Map<string, ExtractedMediaItem[]>();

  // Listen to intercepted media events from MAIN world
  window.addEventListener('__SOC_MEDIA_INTERCEPTED__', (event: any) => {
    const items = event.detail?.items as ExtractedMediaItem[];
    if (Array.isArray(items) && items.length > 0) {
      const groups = new Map<string, ExtractedMediaItem[]>();
      items.forEach((item) => {
        if (item.id) {
          const list = groups.get(item.id) || [];
          list.push(item);
          groups.set(item.id, list);
        }
      });
      groups.forEach((groupItems, id) => {
        mediaCache.set(id, groupItems);
      });
    }
  });

  async function requestDownload(
    items: ExtractedMediaItem[],
    options?: { forceAll?: boolean }
  ): Promise<boolean> {
    const isForceAll = Boolean(options?.forceAll);
    try {
      const res = await chrome.runtime.sendMessage({
        action: 'DOWNLOAD_MEDIA',
        items,
        forceAll: isForceAll,
        explicit: isForceAll
      });
      return res?.success === true;
    } catch {
      return false;
    }
  }

  // Detect hostname and initialize respective platform observer
  const host = window.location.hostname;

  if (host.includes('twitter.com') || host.includes('x.com')) {
    setupTwitterInjector(mediaCache, requestDownload);
  } else if (host.includes('instagram.com')) {
    setupInstagramInjector(mediaCache, requestDownload);
  } else if (host.includes('reddit.com')) {
    setupRedditInjector(mediaCache, requestDownload);
  }
})();
