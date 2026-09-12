import { ExtractedMediaItem } from '../../shared/types';
import { createDownloadButton } from '../ui/button';
import { openPickerModal } from '../ui/pickerModal';
import { toOrigTwimgUrl, parseTwitterMedia } from '../../parsers/twitterParser';

export function extractTweetId(tweetElement: HTMLElement): string {
  // 1. Tweet's direct timestamp link (scoped to avoid nested quote tweets)
  const timeLink = tweetElement.querySelector('time')?.closest('a[href*="/status/"]') as HTMLAnchorElement | null;
  const timeMatch = (timeLink?.getAttribute('href') || timeLink?.href || '').match(/\/status\/(\d+)/);
  if (timeMatch) return timeMatch[1];

  // 2. Fallback to page permalink if on tweet page
  if (typeof window !== 'undefined' && window.location?.pathname) {
    const pageMatch = window.location.pathname.match(/\/status\/(\d+)/);
    if (pageMatch) return pageMatch[1];
  }

  // 3. Fallback to any status link in element
  const link = tweetElement.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
  const match = (link?.getAttribute('href') || link?.href || '').match(/\/status\/(\d+)/);
  if (match) return match[1];

  return '';
}

export function getSyndicationToken(tweetId: string): string {
  return ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

export async function fetchTwitterPostJson(
  tweetId: string,
  mediaCache?: Map<string, ExtractedMediaItem[]>
): Promise<ExtractedMediaItem[] | null> {
  if (!tweetId || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return null;
  const token = getSyndicationToken(tweetId);
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=${token}`;

  try {
    const res = await chrome.runtime.sendMessage({
      action: 'FETCH_TWITTER_SYNDICATION',
      tweetId,
      url
    });

    if (res?.success && res.data) {
      const items = parseTwitterMedia(res.data);
      if (items && items.length > 0) {
        if (mediaCache) {
          mediaCache.set(tweetId, items);
        }
        return items;
      }
    }
  } catch {
    // Network or message error
  }

  return null;
}

export function setupTwitterInjector(
  mediaCache: Map<string, ExtractedMediaItem[]>,
  requestDownload: (items: ExtractedMediaItem[], options?: { forceAll?: boolean }) => Promise<boolean>
) {
  function processTweet(tweetElement: HTMLElement) {
    if (tweetElement.dataset.socInjected) return;

    const actionGroup = tweetElement.querySelector('div[role="group"]');
    if (!actionGroup) return;

    // Extract tweet ID
    const tweetId = extractTweetId(tweetElement);

    // Mark as processed
    tweetElement.dataset.socInjected = 'true';

    const btn = createDownloadButton({
      platform: 'twitter',
      tooltipText: 'Download Original Media',
      onClick: async (_, updateState) => {
        updateState('loading', 'Extracting...');

        // 1. Try from intercepted cache
        let items = tweetId ? mediaCache.get(tweetId) : undefined;

        // 2. Fallback to Twitter Syndication API
        if ((!items || items.length === 0) && tweetId) {
          updateState('loading', 'Fetching media...');
          items = (await fetchTwitterPostJson(tweetId, mediaCache)) || undefined;
        }

        // 3. Fallback to DOM extraction if not captured in network cache
        if (!items || items.length === 0) {
          items = extractFromTweetDom(tweetElement, tweetId);
        }

        if (!items || items.length === 0) {
          updateState('error', 'No media found');
          return;
        }

        if (items.length > 1) {
          updateState('idle');
          openPickerModal({
            items,
            onDownload: async (selected) => {
              updateState('loading', `Downloading ${selected.length} item(s)...`);
              const ok = await requestDownload(selected, { forceAll: true });
              updateState(ok ? 'success' : 'error', ok ? 'Saved!' : 'Download failed');
            },
            onClose: () => updateState('idle')
          });
          return;
        }

        updateState('loading', 'Downloading...');
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
  let debounceTimer: any;
  const pendingNodes: HTMLElement[] = [];

  const observer = new MutationObserver((mutations) => {
    let hasRelevantMutation = false;
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if (el.matches?.('.soc-dl-btn, [data-soc-injected]') || el.closest?.('.soc-dl-btn')) {
            return;
          }
          hasRelevantMutation = true;
          pendingNodes.push(el);
        }
      });
    }

    if (!hasRelevantMutation) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const nodesToProcess = pendingNodes.splice(0, pendingNodes.length);
      for (const el of nodesToProcess) {
        if (!el.isConnected) continue;
        if (el.matches?.('article[data-testid="tweet"]')) {
          processTweet(el);
        } else {
          el.querySelectorAll?.('article[data-testid="tweet"]').forEach((t) => processTweet(t as HTMLElement));
        }
      }
    }, 100);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
