import { ExtractedMediaItem } from '../../shared/types';
import { parseInstagramMedia } from '../../parsers/instagramParser';
import { createDownloadButton } from '../ui/button';
import { openSelectionModal } from '../ui/selectionModal';
import { attachVideoControls } from '../ui/videoControls';

function getBestFromSrcset(srcset: string): string | null {
  if (!srcset) return null;
  const entries = srcset.split(',').map((part) => {
    const [u, w] = part.trim().split(/\s+/);
    const width = parseInt(w?.replace('w', '') || '0', 10);
    return { url: u, width };
  });
  entries.sort((a, b) => b.width - a.width);
  return entries[0]?.url || null;
}

export function setupInstagramInjector(
  mediaCache: Map<string, ExtractedMediaItem[]>,
  requestDownload: (items: ExtractedMediaItem[], options?: { forceAll?: boolean }) => Promise<boolean>
) {
  async function fetchInstagramPostJson(shortcode: string): Promise<ExtractedMediaItem[] | null> {
    if (!shortcode) return null;
    try {
      const res = await fetch(`/p/${shortcode}/?__a=1&__d=dis`, {
        headers: {
          'X-IG-App-ID': '936619743392459',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json'
        },
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        const parsed = parseInstagramMedia(data);
        if (parsed && parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback below
    }

    try {
      const res = await fetch(`/graphql/query/?doc_id=8845758582119845&variables=${encodeURIComponent(
        JSON.stringify({ shortcode })
      )}`, {
        headers: {
          'X-IG-App-ID': '936619743392459',
          'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        const parsed = parseInstagramMedia(data);
        if (parsed && parsed.length > 0) return parsed;
      }
    } catch {
      // Ignore
    }

    return null;
  }

  function findInstagramShareButton(container: HTMLElement): HTMLElement | null {
    // 1. Check aria-label / title on button or svg across languages
    const shareSelectors = [
      'button[aria-label*="Share" i]',
      '[role="button"][aria-label*="Share" i]',
      '[aria-label*="Share Post" i]',
      '[aria-label*="Share reel" i]',
      '[aria-label*="Beitrag teilen" i]',
      '[aria-label*="Teilen" i]',
      '[aria-label*="Partager" i]',
      '[aria-label*="Compartir" i]',
      '[aria-label*="Condividi" i]',
      '[title*="Share" i]',
      'svg[aria-label*="Share" i]'
    ];

    for (const sel of shareSelectors) {
      const el = container.querySelector(sel);
      if (el) {
        return (el.closest('button, [role="button"]') || el) as HTMLElement;
      }
    }

    // 2. Look for paper-plane SVG geometry
    const svgs = Array.from(container.querySelectorAll('svg'));
    for (const svg of svgs) {
      const html = svg.innerHTML || '';
      if (
        html.includes('22 2') ||
        html.includes('22,2') ||
        html.includes('22, 2') ||
        svg.querySelector('line[x1="22"]') ||
        svg.querySelector('polygon[points*="22 2"]') ||
        svg.querySelector('polygon[points*="22,2"]')
      ) {
        const btn = svg.closest('button, [role="button"]') || svg.parentElement;
        if (btn) return btn as HTMLElement;
      }
    }

    // 3. Guaranteed position: Find the left action buttons flex row (via Like or Comment)
    // and select the LAST child of that group (which is ALWAYS the Share button in Instagram's layout)
    const anyLeftBtn = container.querySelector(
      '[aria-label*="Like" i], [aria-label*="Comment" i], [aria-label*="Repost" i], [aria-label*="Gefällt" i], [aria-label*="Unlike" i]'
    );
    if (anyLeftBtn) {
      let curr: HTMLElement | null = anyLeftBtn.closest('button, [role="button"]') || anyLeftBtn.parentElement;
      while (
        curr &&
        curr.parentElement &&
        curr.parentElement.tagName !== 'SECTION' &&
        curr.parentElement.tagName !== 'ARTICLE'
      ) {
        const parent = curr.parentElement;
        if (parent.children.length > 1) {
          return parent.lastElementChild as HTMLElement;
        }
        curr = parent;
      }
    }

    // 4. Fallback to section's first child group's last element
    const section = container.querySelector('section');
    if (section) {
      const firstRow = section.querySelector('div') || section;
      const leftGroup = firstRow.firstElementChild as HTMLElement | null;
      if (leftGroup && leftGroup.children.length > 0) {
        return leftGroup.lastElementChild as HTMLElement;
      }
      return firstRow.lastElementChild as HTMLElement;
    }

    return null;
  }

  function processInstagramPost(container: HTMLElement) {
    if (container.dataset.socInjected && container.querySelector('.soc-dl-btn.soc-instagram')) return;

    const shareTarget = findInstagramShareButton(container);
    if (!shareTarget) return;

    // If shareTarget is wrapped in a single-child wrapper (e.g. <span><button></span>), target wrapper
    let insertPoint = shareTarget;
    while (
      insertPoint.parentElement &&
      insertPoint.parentElement.children.length === 1 &&
      insertPoint.parentElement.tagName !== 'SECTION' &&
      insertPoint.parentElement.tagName !== 'ARTICLE'
    ) {
      insertPoint = insertPoint.parentElement;
    }

    // Extract shortcode / ID
    const link = container.querySelector('a[href*="/p/"], a[href*="/reel/"]') as HTMLAnchorElement | null;
    const match = link?.href.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
    let shortcode = match ? match[2] : '';
    if (!shortcode) {
      const timeLink = container.querySelector('time')?.closest('a') as HTMLAnchorElement | null;
      const timeMatch = timeLink?.href.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
      if (timeMatch) shortcode = timeMatch[2];
    }
    if (!shortcode) {
      const pageMatch = window.location.pathname.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
      if (pageMatch) shortcode = pageMatch[2];
    }

    container.dataset.socInjected = 'true';

    const btn = createDownloadButton({
      platform: 'instagram',
      tooltipText: 'Download',
      onClick: async (_, updateState) => {
        updateState('loading', 'Checking media...');

        let items = shortcode ? mediaCache.get(shortcode) : undefined;

        // Check if container has carousel clues (pagination indicators, dots, next buttons, 1/N text)
        let expectedTotal = 1;
        const pageCountMatch = Array.from(container.querySelectorAll('span, div'))
          .map((el) => el.textContent?.trim() || '')
          .find((text) => /^\d+\/(\d+)$/.test(text));
        if (pageCountMatch) {
          const m = pageCountMatch.match(/^\d+\/(\d+)$/);
          if (m) expectedTotal = parseInt(m[1], 10);
        }

        const hasCarouselClues = expectedTotal > 1 || Boolean(
          container.querySelector(
            'button[aria-label*="Next" i], button[aria-label*="Previous" i], button[aria-label*="Suivant" i], button[aria-label*="Weiter" i], [aria-label*="Carousel" i], .coreSpritePagingChevron, div[role="tablist"]'
          )
        );

        const isIncomplete =
          !items ||
          items.length === 0 ||
          (hasCarouselClues && (items.length < expectedTotal || items.length <= 3));

        if (isIncomplete) {
          // 1. Request MAIN world React Fiber inspection
          window.dispatchEvent(
            new CustomEvent('__SOC_REQUEST_FIBER_MEDIA__', { detail: { shortcode } })
          );
          await new Promise((r) => setTimeout(r, 200));
          if (shortcode) {
            items = mediaCache.get(shortcode);
          }
        }

        if (
          (!items || items.length === 0 || (hasCarouselClues && (items.length < expectedTotal || items.length <= 3))) &&
          shortcode
        ) {
          updateState('loading', 'Loading all slides...');
          const fetchedItems = await fetchInstagramPostJson(shortcode);
          if (fetchedItems && fetchedItems.length > 0) {
            items = fetchedItems;
            mediaCache.set(shortcode, items);
          }
        }

        // Fallback DOM extraction
        if (!items || items.length === 0) {
          items = extractFromDom(container, shortcode, mediaCache);
        }

        if (!items || items.length === 0) {
          updateState('error', 'Media not found');
          return;
        }

        // Multi-media: present thumbnail selection modal
        if (items.length > 1) {
          updateState('idle');
          openSelectionModal({
            items,
            onDownload: async (selectedItems) => {
              updateState('loading', `Downloading ${selectedItems.length} item(s)...`);
              const ok = await requestDownload(selectedItems, { forceAll: true });
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

        // Single media: instant 1-click download
        updateState('loading', 'Downloading...');
        const ok = await requestDownload(items);
        if (ok) {
          updateState('success', 'Saved!');
        } else {
          updateState('error', 'Download failed');
        }
      }
    });

    // If insertPoint is wrapped in a span or div, wrap btn in matching element so it inherits native flex gap and spacing
    let finalElement: HTMLElement = btn;
    if (insertPoint !== shareTarget && (insertPoint.tagName === 'SPAN' || insertPoint.tagName === 'DIV')) {
      const wrapper = document.createElement(insertPoint.tagName);
      if (insertPoint.className) {
        wrapper.className = insertPoint.className;
      }
      wrapper.appendChild(btn);
      finalElement = wrapper;
    }

    // Insert directly after the Share button in the action row
    insertPoint.after(finalElement);
  }

  function getInstagramVideoMountPoint(video: HTMLVideoElement): HTMLElement {
    // 1. Try Instagram React instancekey container
    const instanceContainer = video.closest('div:has(>[data-instancekey]), div[data-instancekey]');
    if (instanceContainer && instanceContainer.parentElement) {
      return instanceContainer.parentElement as HTMLElement;
    }

    // 2. Try climbing up to the element containing the video player frame
    let curr = video.parentElement;
    while (curr && curr.parentElement && curr.parentElement !== document.body) {
      const p = curr.parentElement;
      const tag = p.tagName.toLowerCase();
      const role = p.getAttribute('role');
      if (tag === 'article' || role === 'dialog' || role === 'main' || tag === 'main') {
        return curr;
      }
      curr = p;
    }

    return video.parentElement || video;
  }

  function processInstagramVideos(root: HTMLElement = document.body) {
    const videos = Array.from(root.querySelectorAll('video')) as HTMLVideoElement[];
    videos.forEach((video) => {
      if (video.dataset.socControlsInjected) return;

      const mountPoint = getInstagramVideoMountPoint(video);
      if (!mountPoint) return;

      // Ensure mountPoint has relative positioning for the floating overlay
      const computedPos = window.getComputedStyle(mountPoint).position;
      if (computedPos === 'static') {
        mountPoint.style.position = 'relative';
      }

      video.dataset.socControlsInjected = 'true';

      // Find nearest post/reel shortcode to grab qualities from cache
      const postEl = video.closest('article, div[role="dialog"]') as HTMLElement | null;
      const link = postEl?.querySelector('a[href*="/p/"], a[href*="/reel/"]') as HTMLAnchorElement | null;
      const match = link?.href.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
      let shortcode = match ? match[2] : '';
      if (!shortcode) {
        const timeLink = postEl?.querySelector('time')?.closest('a') as HTMLAnchorElement | null;
        const timeMatch = timeLink?.href.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
        if (timeMatch) shortcode = timeMatch[2];
      }
      if (!shortcode) {
        const pageMatch = window.location.pathname.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
        if (pageMatch) shortcode = pageMatch[2];
      }

      let qualities = shortcode ? mediaCache.get(shortcode)?.[0]?.qualities : undefined;

      attachVideoControls(video, mountPoint, { qualities });
    });
  }

  // Initial pass
  document.querySelectorAll('article, div[role="dialog"]').forEach((el) => processInstagramPost(el as HTMLElement));
  processInstagramVideos(document.body);

  // Observer
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if (el.matches?.('article, div[role="dialog"]')) {
            processInstagramPost(el);
          } else {
            el.querySelectorAll?.('article, div[role="dialog"]').forEach((p) => processInstagramPost(p as HTMLElement));
          }
          if (el.matches?.('video')) {
            processInstagramVideos(el.parentElement || el);
          } else if (el.querySelector?.('video')) {
            processInstagramVideos(el);
          }
        }
      });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

export function extractFromDom(
  container: HTMLElement,
  shortcode: string,
  mediaCache?: Map<string, ExtractedMediaItem[]>
): ExtractedMediaItem[] {
  const results: ExtractedMediaItem[] = [];
  const id = shortcode || String(Date.now());

  // Author
  const authorEl = container.querySelector('header a, a[role="link"][tabindex="0"]') as HTMLAnchorElement | null;
  const author = authorEl?.textContent?.trim() || 'instagram_user';

  // Check video
  const video = container.querySelector('video') as HTMLVideoElement | null;
  if (video) {
    const cached = (shortcode && mediaCache?.get(shortcode)) || (id ? mediaCache?.get(id) : undefined);
    if (cached && cached.length > 0 && cached[0].type === 'video') {
      return cached;
    }

    const directSrc = !video.src.startsWith('blob:') ? video.src : video.querySelector('source')?.src;
    if (directSrc && !directSrc.startsWith('blob:')) {
      results.push({
        id,
        platform: 'instagram',
        type: 'video',
        author,
        url: directSrc,
        ext: '.mp4',
        thumbnailUrl: video.poster || undefined
      });
      return results;
    }

    // Video has blob: src and no direct mp4 found in DOM.
    // Do NOT fall back to scraping page images or poster jpeg.
    return [];
  }

  // Check images strictly if NOT a video post
  const images = Array.from(container.querySelectorAll('img[src*="cdninstagram.com"], img[src*="fbcdn.net"]')) as HTMLImageElement[];
  // Filter out profile avatar images (usually small or circular)
  const contentImages = images.filter((img) => {
    if (img.closest('header, [role="button"], a[role="link"][tabindex="0"]')) {
      return false;
    }
    const rect = img.getBoundingClientRect();
    return rect.width > 150 && rect.height > 150;
  });

  contentImages.forEach((img, idx) => {
    const bestUrl = getBestFromSrcset(img.srcset) || img.src;
    results.push({
      id,
      platform: 'instagram',
      type: 'image',
      author,
      url: bestUrl,
      ext: '.jpg',
      index: idx + 1,
      total: contentImages.length,
      thumbnailUrl: img.src
    });
  });

  return results;
}

