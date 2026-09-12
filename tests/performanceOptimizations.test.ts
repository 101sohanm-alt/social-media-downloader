import { describe, it, expect, vi } from 'vitest';
import { isTargetUrl } from '../src/content/main_interceptor';
import * as twitterParser from '../src/parsers/twitterParser';

describe('Performance Optimizations - Verification', () => {
  describe('Network Interceptor: isTargetUrl static media exclusion', () => {
    it('excludes static media and asset URLs while keeping API endpoints', () => {
      // Static media formats that should be excluded
      expect(isTargetUrl('https://video.twimg.com/ext_tw_video/123/pu/vid/720x1280/video.mp4')).toBe(false);
      expect(isTargetUrl('https://video.twimg.com/ext_tw_video/123/pu/vid/720x1280/video.mp4?tag=12')).toBe(false);
      expect(isTargetUrl('https://video.twimg.com/ext_tw_video/123/pu/pl/master.m3u8')).toBe(false);
      expect(isTargetUrl('https://video.twimg.com/ext_tw_video/123/pu/vid/segment.ts')).toBe(false);
      expect(isTargetUrl('https://video.twimg.com/ext_tw_video/123/pu/vid/init.m4s')).toBe(false);
      expect(isTargetUrl('https://video.twimg.com/ext_tw_video/123/pu/vid/sample.webm')).toBe(false);
      expect(isTargetUrl('https://pbs.twimg.com/media/abc.jpg')).toBe(false);
      expect(isTargetUrl('https://pbs.twimg.com/media/abc.jpeg?format=jpg')).toBe(false);
      expect(isTargetUrl('https://pbs.twimg.com/media/abc.png')).toBe(false);
      expect(isTargetUrl('https://pbs.twimg.com/media/abc.webp')).toBe(false);
      expect(isTargetUrl('https://pbs.twimg.com/media/abc.gif')).toBe(false);
      expect(isTargetUrl('https://static.cdninstagram.com/rsrc.php/v3/style.css')).toBe(false);
      expect(isTargetUrl('https://static.cdninstagram.com/rsrc.php/v3/font.woff2')).toBe(false);

      // JSON and API endpoints that must still match
      expect(isTargetUrl('https://twitter.com/i/api/graphql/123/TweetDetail')).toBe(true);
      expect(isTargetUrl('https://www.instagram.com/graphql/query')).toBe(true);
      expect(isTargetUrl('https://www.reddit.com/r/videos/comments/123.json')).toBe(true);
    });
  });

  describe('Network Interceptor: fetch content-type inspection', () => {
    it('does not clone or parse responses without application/json Content-Type', async () => {
      const cloneSpy = vi.fn();
      const mockResponse = {
        ok: true,
        headers: new Headers({ 'content-type': 'video/mp4' }),
        clone: cloneSpy
      };

      // Reset modules to bind interceptor over our mock
      vi.resetModules();
      window.fetch = vi.fn().mockResolvedValue(mockResponse);

      await import('../src/content/main_interceptor');

      // Call fetch through the interceptor with a target API URL
      await window.fetch('https://twitter.com/i/api/graphql/testEndpoint');

      // Allow microtask ticks for promise chain in interceptor
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(cloneSpy).not.toHaveBeenCalled();
    });
  });

  describe('Twitter Parser: Recursion Depth Bounding', () => {
    it('enforces a depth limit of maxDepth = 15 on deeply nested structures', () => {
      let deepObj: any = {
        __typename: 'Tweet',
        rest_id: 'deep_tweet_999',
        legacy: { full_text: 'deep tweet' }
      };

      // Nest 20 levels deep
      for (let i = 0; i < 20; i++) {
        deepObj = { nested: deepObj };
      }

      const nodes = twitterParser.traverseTweetNodes(deepObj, new Set());
      expect(nodes).toEqual([]);
    });
  });

  describe('Twitter Parser: TweetWithVisibilityResults Fast-Path', () => {
    it('does not invoke findTweetNode / collectAllTweetNodes on TweetWithVisibilityResults with tweet data', () => {
      const collectSpy = vi.spyOn(twitterParser, 'collectAllTweetNodes');

      const payload = {
        result: {
          __typename: 'TweetWithVisibilityResults',
          tweet: {
            rest_id: '987654321',
            legacy: {
              full_text: 'Direct tweet text',
              user: { screen_name: 'direct_user' },
              extended_entities: {
                media: [
                  {
                    id_str: 'media_1',
                    type: 'photo',
                    media_url_https: 'https://pbs.twimg.com/media/test.jpg'
                  }
                ]
              }
            }
          }
        }
      };

      const parsed = twitterParser.parseTwitterTweet(payload);
      expect(parsed).not.toBeNull();
      expect(parsed?.id).toBe('987654321');
      expect(collectSpy).not.toHaveBeenCalled();

      collectSpy.mockRestore();
    });
  });
});
