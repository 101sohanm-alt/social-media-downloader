import { ExtractedMediaItem } from '../../shared/types';
import { createDownloadButton } from '../ui/button';
import { toOrigTwimgUrl } from '../../parsers/twitterParser';

export function setupTwitterInjector(
  mediaCache: Map<string, ExtractedMediaItem[]>,
  requestDownload: (items: ExtractedMediaItem[], options?: { forceAll?: boolean }) => Promise<boolean>
) {
  function processTweet(tweetElement: HTMLElement) {
    if (tweetElement.dataset.socInjected) return;

    const actionGroup = tweetElement.querySelector('div[role="group"]');
    if (!actionGroup) return;

    // Extract tweet ID from permalink link
    const link = tweetElement.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
    const match = link?.href.match(/\/status\/(\d+)/);
    const tweetId = match ? match[1] : '';

    // Mark as processed
    tweetElement.dataset.socInjected = 'true';

    const btn = createDownloadButton({
      platform: 'twitter',
      tooltipText: 'Download Original Media',
      onClick: async (_, updateState) => {
        updateState('loading', 'Extracting...');

        // 1. Try from intercepted cache
        let items = tweetId ? mediaCache.get(tweetId) : undefined;

        // 2. Fallback to DOM extraction if not captured in network cache
        if (!items || items.length === 0) {
          items = extractFromTweetDom(tweetElement, tweetId);
        }

        if (!items || items.length === 0) {
          updateState('error', 'No media found');
          return;
        }

        const loadingText = items.length > 1 ? `Downloading ${items.length} items...` : 'Downloading...';
        updateState('loading', loadingText);
        const ok = await requestDownload(items, { forceAll: true });
        if (ok) {
          updateState('success', 'Saved!');
        } else {
          updateState('error', 'Download failed');
        }
      }
    });

    actionGroup.appendChild(btn);
  }

  function extractFromTweetDom(tweetElement: HTMLElement, tweetId: string): ExtractedMediaItem[] {
    const results: ExtractedMediaItem[] = [];
    const id = tweetId || String(Date.now());

    // Author
    const userLink = tweetElement.querySelector('div[data-testid="User-Name"] a') as HTMLAnchorElement | null;
    const author = userLink?.textContent?.replace('@', '').trim() || 'twitter_user';

    // Images
    const images = Array.from(tweetElement.querySelectorAll('img[src*="twimg.com/media/"]')) as HTMLImageElement[];
    images.forEach((img, idx) => {
      const orig = toOrigTwimgUrl(img.src);
      results.push({
        id,
        platform: 'twitter',
        type: 'image',
        author,
        url: orig.url,
        ext: `.${orig.ext}`,
        index: idx + 1,
        total: images.length
      });
    });

    // Videos
    const videos = Array.from(tweetElement.querySelectorAll('video')) as HTMLVideoElement[];
    videos.forEach((vid, idx) => {
      const src = vid.src || vid.querySelector('source')?.src;
      if (src && !src.startsWith('blob:')) {
        results.push({
          id,
          platform: 'twitter',
          type: 'video',
          author,
          url: src,
          ext: '.mp4',
          index: idx + 1,
          total: videos.length
        });
      }
    });

    return results;
  }

  // Scan current DOM
  document.querySelectorAll('article[data-testid="tweet"]').forEach((el) => processTweet(el as HTMLElement));

  // MutationObserver for virtualized feed
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if (el.matches?.('article[data-testid="tweet"]')) {
            processTweet(el);
          } else {
            el.querySelectorAll?.('article[data-testid="tweet"]').forEach((t) => processTweet(t as HTMLElement));
          }
        }
      });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
