import { describe, it, expect, beforeEach } from 'vitest';
import { extractTweetId, getSyndicationToken } from '../src/content/platforms/twitter';

describe('Twitter Fallback & ID Extraction', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('extractTweetId', () => {
    it("returns parent tweet's ID when a nested quote tweet is present", () => {
      const tweetElement = document.createElement('article');
      tweetElement.setAttribute('data-testid', 'tweet');
      tweetElement.innerHTML = `
        <div data-testid="User-Name">
          <a href="/parent_user">Parent User</a>
          <a href="/parent_user/status/1234567890">
            <time datetime="2024-01-01T00:00:00.000Z">Jan 1</time>
          </a>
        </div>
        <div class="tweet-text">Here is a quote tweet:</div>
        <div class="quote-tweet-container" role="link">
          <a href="/quoted_user">Quoted User</a>
          <a href="/quoted_user/status/9876543210">
            <time datetime="2023-12-31T00:00:00.000Z">Dec 31</time>
          </a>
        </div>
      `;
      document.body.appendChild(tweetElement);

      const tweetId = extractTweetId(tweetElement);
      expect(tweetId).toBe('1234567890');
    });

    it('falls back to window.location.pathname when element has no status link', () => {
      const originalPathname = window.location.pathname;
      try {
        Object.defineProperty(window, 'location', {
          value: {
            ...window.location,
            pathname: '/elonmusk/status/1789000111222',
          },
          writable: true,
          configurable: true,
        });

        const tweetElement = document.createElement('article');
        tweetElement.setAttribute('data-testid', 'tweet');
        tweetElement.innerHTML = `
          <div data-testid="User-Name">
            <span>User Without Direct Time Link</span>
          </div>
        `;
        document.body.appendChild(tweetElement);

        const tweetId = extractTweetId(tweetElement);
        expect(tweetId).toBe('1789000111222');
      } finally {
        Object.defineProperty(window, 'location', {
          value: {
            ...window.location,
            pathname: originalPathname,
          },
          writable: true,
          configurable: true,
        });
      }
    });

    it('falls back to any status link inside tweet element if time tag is absent', () => {
      const tweetElement = document.createElement('article');
      tweetElement.setAttribute('data-testid', 'tweet');
      tweetElement.innerHTML = `
        <div>
          <a href="/someuser/status/4455667788">View post</a>
        </div>
      `;
      document.body.appendChild(tweetElement);

      const tweetId = extractTweetId(tweetElement);
      expect(tweetId).toBe('4455667788');
    });
  });

  describe('getSyndicationToken', () => {
    it('computes syndication token according to formula', () => {
      const id = '1234567890';
      const expectedToken = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
      expect(getSyndicationToken(id)).toBe(expectedToken);
    });

    it('computes expected token for high snowflake ID', () => {
      const id = '1834289098765432100';
      const expectedToken = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
      expect(getSyndicationToken(id)).toBe(expectedToken);
      expect(getSyndicationToken(id).length).toBeGreaterThan(0);
      expect(getSyndicationToken(id)).not.toContain('.');
      expect(getSyndicationToken(id)).not.toContain('0');
    });
  });

  describe('fetchTwitterPostJson', () => {
    it('fetches syndication data via background runtime message and updates cache', async () => {
      const { fetchTwitterPostJson } = await import('../src/content/platforms/twitter');
      const mediaCache = new Map<string, any>();

      (globalThis as any).chrome = {
        runtime: {
          sendMessage: async (msg: any) => {
            if (msg.action === 'FETCH_TWITTER_SYNDICATION' && msg.tweetId === '12345') {
              return {
                success: true,
                data: {
                  id_str: '12345',
                  user: { screen_name: 'elonmusk' },
                  photos: [
                    {
                      url: 'https://pbs.twimg.com/media/synd_test.jpg',
                      width: 1000,
                      height: 800,
                    },
                  ],
                },
              };
            }
            return { success: false };
          },
        },
      };

      const items = await fetchTwitterPostJson('12345', mediaCache);
      expect(items).not.toBeNull();
      expect(items).toHaveLength(1);
      expect(items![0].url).toContain('synd_test');
      expect(mediaCache.get('12345')).toEqual(items);
    });
  });

  describe('Early Interception Handshake', () => {
    it('buffers intercepted items and replays on __SOC_REQUEST_BUFFER__', async () => {
      const { dispatchIntercepted, interceptedBuffer } = await import('../src/content/main_interceptor');

      const mockItem = {
        id: 'early_tweet_1',
        platform: 'twitter' as const,
        type: 'image' as const,
        author: 'early_user',
        url: 'https://pbs.twimg.com/media/early.jpg',
        ext: '.jpg',
      };

      dispatchIntercepted([mockItem]);
      expect(interceptedBuffer.some((item) => item.id === 'early_tweet_1')).toBe(true);

      let replayedItems: any[] = [];
      const listener = (event: any) => {
        replayedItems = event.detail?.items || [];
      };
      window.addEventListener('__SOC_MEDIA_INTERCEPTED__', listener);

      window.dispatchEvent(new CustomEvent('__SOC_REQUEST_BUFFER__'));

      expect(replayedItems.some((item) => item.id === 'early_tweet_1')).toBe(true);
      window.removeEventListener('__SOC_MEDIA_INTERCEPTED__', listener);
    });
  });
});

