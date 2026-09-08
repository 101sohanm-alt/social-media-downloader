import { parseTwitterMedia } from '../parsers/twitterParser';
import { parseInstagramMedia } from '../parsers/instagramParser';
import { parseRedditMedia } from '../parsers/redditParser';
import { ExtractedMediaItem } from '../shared/types';

(function initNetworkInterceptor() {
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

  function dispatchIntercepted(items: ExtractedMediaItem[]) {
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
  function extractMediaFromFiber(container: Element): ExtractedMediaItem[] | null {
    try {
      for (const key of Object.keys(container)) {
        if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
          let fiber = (container as any)[key];
          let depth = 0;
          while (fiber && depth < 50) {
            const props = fiber.memoizedProps;
            const post = props?.post || props?.media || props?.item || props?.mediaItem;
            if (post) {
              const parsed = parseInstagramMedia(post);
              if (parsed && parsed.length > 0) return parsed;
            }
            fiber = fiber.return;
            depth++;
          }
        }
      }
    } catch {
      // Ignore
    }
    return null;
  }

  // Listen to fiber media requests from isolated bridge
  window.addEventListener('__SOC_REQUEST_FIBER_MEDIA__', (event: any) => {
    const shortcode = event.detail?.shortcode;
    const articles = Array.from(document.querySelectorAll('article, div[role="dialog"], [role="main"]'));
    for (const art of articles) {
      const link = art.querySelector('a[href*="/p/"], a[href*="/reel/"]') as HTMLAnchorElement | null;
      if (!shortcode || (link && link.href.includes(shortcode))) {
        const items = extractMediaFromFiber(art);
        if (items && items.length > 0) {
          dispatchIntercepted(items);
          if (shortcode) return;
        }
      }
    }
  });

  // Scan fibers on visible articles
  function scanVisibleFibers() {
    if (!window.location.hostname.includes('instagram.com')) return;
    const articles = Array.from(document.querySelectorAll('article, div[role="dialog"]'));
    for (const art of articles) {
      if ((art as any)._soc_fiber_scanned) continue;
      const items = extractMediaFromFiber(art);
      if (items && items.length > 0) {
        (art as any)._soc_fiber_scanned = true;
        dispatchIntercepted(items);
      }
    }
  }

  setTimeout(scanVisibleFibers, 1000);
  setInterval(scanVisibleFibers, 3000);
})();
