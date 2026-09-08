import { ExtractedMediaItem, MediaQuality } from '../../shared/types';
import { createDownloadButton } from '../ui/button';
import { openSelectionModal } from '../ui/selectionModal';
import { attachVideoControls } from '../ui/videoControls';
import { parseRedditMedia } from '../../parsers/redditParser';

export function setupRedditInjector(
  mediaCache: Map<string, ExtractedMediaItem[]>,
  requestDownload: (items: ExtractedMediaItem[], options?: { forceAll?: boolean }) => Promise<boolean>
) {
  function cleanPostId(rawId: string): string {
    return rawId.replace(/^t3_/, '');
  }

  function processRedditPost(postElement: HTMLElement) {
    if (postElement.dataset.socInjected) return;

    // Modern Reddit (shreddit-post) vs classic Reddit
    const actionRow =
      postElement.querySelector('div[slot="action-row"]') ||
      postElement.querySelector('.flat-list.buttons') ||
      postElement.querySelector('[slot="credit-bar"]');

    if (!actionRow) return;

    const rawId = postElement.getAttribute('id') || postElement.getAttribute('data-fullname') || '';
    const postId = cleanPostId(rawId);

    postElement.dataset.socInjected = 'true';

    const btn = createDownloadButton({
      platform: 'reddit',
      tooltipText: 'Download Reddit Media',
      onClick: async (_, updateState) => {
        updateState('loading', 'Fetching media...');

        // 1. Try cache
        let items = postId ? mediaCache.get(postId) : undefined;

        // 2. If not in cache, fetch Reddit JSON for post
        if (!items || items.length === 0) {
          const fetched = await fetchPostViaJson(postId, postElement);
          if (fetched && fetched.length > 0) {
            items = fetched;
          }
        }

        // 3. Fallback to direct DOM scraper
        if (!items || items.length === 0) {
          items = extractFromRedditDom(postElement, postId);
        }

        if (!items || items.length === 0) {
          updateState('error', 'No media found');
          return;
        }

        // Multi-media gallery: open selection modal
        if (items.length > 1) {
          updateState('idle');
          openSelectionModal({
            items,
            postTitle: items[0].title || 'Reddit Gallery',
            onDownload: async (selected) => {
              updateState('loading', `Downloading ${selected.length} item(s)...`);
              const ok = await requestDownload(selected, { forceAll: true });
              if (ok) {
                updateState('success', 'Saved!');
              } else {
                updateState('error', 'Download failed');
              }
            },
            onCancel: () => {
              updateState('idle');
            }
          });
          return;
        }

        // Single media item: instant 1-click download
        updateState('loading', 'Downloading...');
        const ok = await requestDownload(items);
        if (ok) {
          updateState('success', 'Saved!');
        } else {
          updateState('error', 'Download failed');
        }
      }
    });

    actionRow.appendChild(btn);
  }

  function processRedditVideoPlayers(root: HTMLElement = document.body) {
    // Classic Reddit and standalone <video> tags (shreddit-player already has native player controls)
    const videos = Array.from(root.querySelectorAll('video')) as HTMLVideoElement[];
    videos.forEach((video) => {
      if (video.dataset.socControlsInjected) return;
      if (video.closest('shreddit-player')) return; // Handled by Reddit's native player controls

      const parent = video.parentElement;
      if (!parent) return;

      video.dataset.socControlsInjected = 'true';
      const computedPos = window.getComputedStyle(parent).position;
      if (computedPos === 'static') {
        parent.style.position = 'relative';
      }

      const postEl = video.closest('shreddit-post, div.thing') as HTMLElement | null;
      const rawId = postEl?.getAttribute('id') || postEl?.getAttribute('data-fullname') || '';
      const postId = cleanPostId(rawId);
      const qualities = postId ? mediaCache.get(postId)?.[0]?.qualities : undefined;

      attachVideoControls(video, parent, { qualities });
    });
  }

  async function fetchPostViaJson(postId: string, postElement: HTMLElement): Promise<ExtractedMediaItem[] | undefined> {
    try {
      let permalink = postElement.getAttribute('permalink');
      if (!permalink) {
        const link = postElement.querySelector('a[data-click-id="body"], a[slot="full-post-link"]') as HTMLAnchorElement | null;
        if (link?.pathname) {
          permalink = link.pathname;
        }
      }

      const url = permalink
        ? `${window.location.origin}${permalink.replace(/\/$/, '')}.json`
        : postId
        ? `${window.location.origin}/comments/${postId}.json`
        : null;

      if (!url) return undefined;

      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return undefined;
      const json = await res.json();
      const parsed = parseRedditMedia(json);
      if (parsed.length > 0) {
        return parsed;
      }
    } catch {
      // Fallback
    }
    return undefined;
  }

  function extractFromRedditDom(postElement: HTMLElement, postId: string): ExtractedMediaItem[] {
    const results: ExtractedMediaItem[] = [];
    const id = postId || String(Date.now());
    const author = postElement.getAttribute('author') || 'reddit_user';
    const title = postElement.getAttribute('post-title') || '';

    // Check shreddit-player / video
    const player = postElement.querySelector('shreddit-player') as HTMLElement | null;
    const packagedUrl = player?.getAttribute('packaged-media-json');
    if (packagedUrl) {
      try {
        const parsed = JSON.parse(packagedUrl);
        const sourceUrl = parsed.playbackMp4?.fallbackUrl || parsed.scrubberMedia?.url;
        if (sourceUrl) {
          results.push({
            id,
            platform: 'reddit',
            type: 'video',
            author,
            title,
            url: sourceUrl,
            ext: '.mp4'
          });
          return results;
        }
      } catch {
        // Fallback
      }
    }

    // Direct images in post
    const img = postElement.querySelector('img[src*="i.redd.it"], img[src*="preview.redd.it"]') as HTMLImageElement | null;
    if (img && img.src) {
      results.push({
        id,
        platform: 'reddit',
        type: 'image',
        author,
        title,
        url: img.src,
        ext: '.jpg'
      });
    }

    return results;
  }

  // Initial scan
  document.querySelectorAll('shreddit-post, div.thing').forEach((el) => processRedditPost(el as HTMLElement));
  processRedditVideoPlayers(document.body);

  // MutationObserver
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if (el.matches?.('shreddit-post, div.thing')) {
            processRedditPost(el);
          } else {
            el.querySelectorAll?.('shreddit-post, div.thing').forEach((p) => processRedditPost(p as HTMLElement));
          }
          if (el.matches?.('shreddit-player, video')) {
            processRedditVideoPlayers(el.parentElement || el);
          } else if (el.querySelector?.('shreddit-player, video')) {
            processRedditVideoPlayers(el);
          }
        }
      });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

