import { parseTwitterMedia } from '../parsers/twitterParser';
import { parseInstagramMedia } from '../parsers/instagramParser';
import { parseRedditMedia } from '../parsers/redditParser';
import { ExtractedMediaItem } from '../shared/types';

const TARGET_DOMAINS = [
  'twitter.com',
  'x.com',
  'instagram.com',
  'reddit.com',
  'redd.it',
  'twimg.com',
  'cdninstagram.com'
];

function isTargetUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  // Exclude analytics, ads, and third-party trackers
  if (
    url.includes('google.com') ||
    url.includes('doubleclick.net') ||
    url.includes('/collect') ||
    url.includes('gtag') ||
    url.includes('analytics')
  ) {
    return false;
  }
  if (url.startsWith('/') || url.startsWith('./')) return true;
  return TARGET_DOMAINS.some((domain) => url.includes(domain));
}

export function dispatchIntercepted(items: ExtractedMediaItem[]) {
  if (!items || items.length === 0) return;
  window.dispatchEvent(
    new CustomEvent('__SOC_MEDIA_INTERCEPTED__', {
      detail: { items }
    })
  );
}

  function handleJsonResponse(url: string, json: any) {
    try {
      // 1. Twitter / X
      if (url.includes('twitter.com') || url.includes('x.com') || url.includes('/graphql/')) {
        const items = parseTwitterMedia(json);
        if (items.length > 0) dispatchIntercepted(items);
      }

      // 2. Instagram
      if (
        url.includes('instagram.com') ||
        url.includes('/graphql/query') ||
        url.includes('/api/v1/') ||
        url.includes('/api/graphql')
      ) {
        const items = parseInstagramMedia(json);
        if (items.length > 0) dispatchIntercepted(items);
      }

      // 3. Reddit
      if (url.includes('reddit.com') || url.includes('/comments/') || url.includes('gql.reddit.com')) {
        const items = parseRedditMedia(json);
        if (items.length > 0) dispatchIntercepted(items);
      }
    } catch {
      // Non-intrusive: silent catch
    }
  }

  // Intercept window.fetch strictly on target domains without creating async wrapper promises
  const originalFetch = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    let url = '';
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else if (input && typeof (input as any).url === 'string') {
      url = (input as any).url;
    }

    // Direct passthrough for non-target domains (e.g. Google remarketing, DoubleClick)
    if (!isTargetUrl(url)) {
      return originalFetch.call(this, input, init);
    }

    const fetchPromise = originalFetch.call(this, input, init);
    fetchPromise
      .then((response) => {
        try {
          if (response && response.ok) {
            response
              .clone()
              .json()
              .then((data) => handleJsonResponse(url, data))
              .catch(() => {});
          }
        } catch {
          // Ignore
        }
      })
      .catch(() => {
        // Silent catch in interceptor so third-party network issues don't log unhandled rejections
      });

    return fetchPromise;
  };

  // Intercept XMLHttpRequest strictly on target domains
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (...args: any[]) {
    const url = args[1];
    if (typeof url === 'string' && isTargetUrl(url)) {
      (this as any)._soc_url = url;
    }
    return originalOpen.apply(this, args as any);
  };

  XMLHttpRequest.prototype.send = function (...args: any[]) {
    if ((this as any)._soc_url) {
      this.addEventListener('load', function () {
        try {
          const url = (this as any)._soc_url;
          const contentType = this.getResponseHeader('content-type') || '';
          if (contentType.includes('application/json') || this.responseType === 'json') {
            const data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
            handleJsonResponse(url, data);
          }
        } catch {
          // Ignore
        }
      });
    }
    return originalSend.apply(this, args as any);
  };

  // MAIN World React Fiber Extraction for Instagram (where React internal keys exist)
// MAIN World React Fiber Extraction for Instagram (where React internal keys exist)
export function extractMediaFromFiber(
  container: Element,
  targetShortcode?: string
): ExtractedMediaItem[] | null {
  try {
    const elementsToInspect: Element[] = [container];
    const videos = container.querySelectorAll('video');
    videos.forEach((v) => elementsToInspect.push(v));
    const children = container.querySelectorAll('article, div[role="dialog"], ul');
    children.forEach((c) => elementsToInspect.push(c));

    for (const el of elementsToInspect) {
      const propNames = Array.from(new Set([...Object.keys(el), ...Object.getOwnPropertyNames(el)]));
      for (const key of propNames) {
        if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
          let fiber = (el as any)[key];
          let depth = 0;
          while (fiber && depth < 60) {
            const props = fiber.memoizedProps;
            if (props) {
              const post =
                props.post ||
                props.media ||
                props.item ||
                props.mediaItem ||
                props.clip?.media ||
                props.clip ||
                props.reel?.media ||
                props.reel ||
                (props.video_versions ? props : null);
              if (post) {
                const candidateCode = post.code || post.shortcode;
                if (!targetShortcode || !candidateCode || candidateCode === targetShortcode) {
                  const parsed = parseInstagramMedia(post);
                  if (parsed && parsed.length > 0) {
                    if (targetShortcode) {
                      parsed.forEach((it) => { it.id = targetShortcode; });
                    } else if (candidateCode) {
                      parsed.forEach((it) => { it.id = candidateCode; });
                    }
                    return parsed;
                  }
                }
              }
            }
            let state = fiber.memoizedState;
            while (state && typeof state === 'object') {
              const sProps = state.memoizedProps || state.memoizedState;
              if (sProps) {
                const post =
                  sProps.post ||
                  sProps.media ||
                  sProps.item ||
                  sProps.mediaItem ||
                  sProps.clip?.media ||
                  sProps.clip ||
                  sProps.reel;
                if (post) {
                  const candidateCode = post.code || post.shortcode;
                  if (!targetShortcode || !candidateCode || candidateCode === targetShortcode) {
                    const parsed = parseInstagramMedia(post);
                    if (parsed && parsed.length > 0) {
                      if (targetShortcode) {
                        parsed.forEach((it) => { it.id = targetShortcode; });
                      } else if (candidateCode) {
                        parsed.forEach((it) => { it.id = candidateCode; });
                      }
                      return parsed;
                    }
                  }
                }
              }
              state = state.next;
            }
            fiber = fiber.return;
            depth++;
          }
        }
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

export function matchesShortcode(el: Element, shortcode: string): boolean {
  if (!shortcode) return false;
  // 1. Direct or descendant links
  const links = Array.from(el.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')) as HTMLAnchorElement[];
  for (const l of links) {
    if (l.href.includes(`/p/${shortcode}`) || l.href.includes(`/reel/${shortcode}`)) {
      return true;
    }
  }
  if (links.some((l) => /\/(p|reel)\/([A-Za-z0-9_-]+)/.test(l.href))) {
    return false;
  }

  // 2. Parent post container
  const postContainer = el.closest('article, div[role="dialog"]');
  if (postContainer && postContainer !== el) {
    const parentLinks = Array.from(postContainer.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')) as HTMLAnchorElement[];
    for (const l of parentLinks) {
      if (l.href.includes(`/p/${shortcode}`) || l.href.includes(`/reel/${shortcode}`)) {
        return true;
      }
    }
    if (parentLinks.some((l) => /\/(p|reel)\/([A-Za-z0-9_-]+)/.test(l.href))) {
      return false;
    }
  }

  // 3. Fallback: If on post/reel page and el is within the dedicated post container with no competing links
  const urlMatch = window.location.pathname.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
  if (urlMatch && urlMatch[2] === shortcode) {
    if (el.matches?.('article, div[role="dialog"]') || el.closest?.('article, div[role="dialog"]')) {
      return true;
    }
  }
  return false;
}

// Listen to fiber media requests from isolated bridge
if (typeof window !== 'undefined') {
  window.addEventListener('__SOC_REQUEST_FIBER_MEDIA__', (event: any) => {
    const pageShortcode = window.location.pathname.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/)?.[2] || '';
    const shortcode = event.detail?.shortcode || pageShortcode;

    const targets: Element[] = [];
    document.querySelectorAll('video').forEach((v) => targets.push(v));
    document.querySelectorAll('article, div[role="dialog"]').forEach((a) => targets.push(a));

    for (const target of targets) {
      if (matchesShortcode(target, shortcode)) {
        const items = extractMediaFromFiber(target, shortcode);
        if (items && items.length > 0) {
          dispatchIntercepted(items);
          return;
        }
      }
    }
  });

  // Scan fibers on visible articles and video containers
  function scanVisibleFibers() {
    if (!window.location.hostname.includes('instagram.com')) return;
    const targets = Array.from(document.querySelectorAll('article, div[role="dialog"], video'));
    for (const t of targets) {
      if ((t as any)._soc_fiber_scanned) continue;
      const items = extractMediaFromFiber(t);
      if (items && items.length > 0) {
        (t as any)._soc_fiber_scanned = true;
        dispatchIntercepted(items);
      }
    }
  }

  setTimeout(scanVisibleFibers, 1000);
  setInterval(scanVisibleFibers, 3000);
}
