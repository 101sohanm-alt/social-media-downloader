import { parseTwitterMedia } from '../parsers/twitterParser';
import { parseInstagramMedia } from '../parsers/instagramParser';
import { parseRedditMedia } from '../parsers/redditParser';
import { ExtractedMediaItem } from '../shared/types';

(function initNetworkInterceptor() {
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
      if (url.includes('instagram.com') || url.includes('/graphql/query') || url.includes('/api/v1/')) {
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

  // Intercept window.fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url || '';
      if (
        url.includes('twitter.com') ||
        url.includes('x.com') ||
        url.includes('instagram.com') ||
        url.includes('reddit.com')
      ) {
        response
          .clone()
          .json()
          .then((data) => handleJsonResponse(url, data))
          .catch(() => {});
      }
    } catch {
      // Ignore
    }
    return response;
  };

  // Intercept XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (...args: any[]) {
    (this as any)._soc_url = args[1];
    return originalOpen.apply(this, args as any);
  };

  XMLHttpRequest.prototype.send = function (...args: any[]) {
    this.addEventListener('load', function () {
      try {
        const url = (this as any)._soc_url;
        if (
          typeof url === 'string' &&
          (url.includes('twitter.com') ||
            url.includes('x.com') ||
            url.includes('instagram.com') ||
            url.includes('reddit.com'))
        ) {
          const contentType = this.getResponseHeader('content-type') || '';
          if (contentType.includes('application/json') || this.responseType === 'json') {
            const data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
            handleJsonResponse(url, data);
          }
        }
      } catch {
        // Ignore
      }
    });
    return originalSend.apply(this, args as any);
  };
})();
