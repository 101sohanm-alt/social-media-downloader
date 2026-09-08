import { describe, it, expect, beforeEach } from 'vitest';
import { extractFromDom } from '../src/content/platforms/instagram';
import { matchesShortcode, extractMediaFromFiber } from '../src/content/main_interceptor';
import { ExtractedMediaItem } from '../src/shared/types';

describe('Instagram Media Attribution & Fallback Isolation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('extractFromDom blob video fallback', () => {
    it('returns empty array when video has blob: src and direct mp4 does not exist', () => {
      const container = document.createElement('article');
      const video = document.createElement('video');
      video.src = 'blob:https://www.instagram.com/abcd-1234';
      video.poster = 'https://instagram.fna.fbcdn.net/preview_poster.jpg';
      container.appendChild(video);

      // Add other images into container (e.g. feed preview or thumbnails)
      const feedImg = document.createElement('img');
      feedImg.src = 'https://instagram.fna.fbcdn.net/other_random_image.jpg';
      Object.defineProperty(feedImg, 'getBoundingClientRect', {
        value: () => ({ width: 300, height: 300 })
      });
      container.appendChild(feedImg);

      const items = extractFromDom(container, 'SHORTCODE1');
      // Must NOT return poster image or unrelated images when video is a blob
      expect(items).toEqual([]);
    });

    it('returns video item when video has a direct non-blob mp4 src', () => {
      const container = document.createElement('article');
      const video = document.createElement('video');
      video.src = 'https://instagram.fna.fbcdn.net/valid_video.mp4';
      video.poster = 'https://instagram.fna.fbcdn.net/poster.jpg';
      container.appendChild(video);

      const items = extractFromDom(container, 'SHORTCODE2');
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe('video');
      expect(items[0].id).toBe('SHORTCODE2');
      expect(items[0].url).toBe('https://instagram.fna.fbcdn.net/valid_video.mp4');
    });

    it('returns images when post contains only content images and no video', () => {
      const container = document.createElement('article');
      const img = document.createElement('img');
      img.src = 'https://instagram.fna.fbcdn.net/photo1.jpg';
      Object.defineProperty(img, 'getBoundingClientRect', {
        value: () => ({ width: 400, height: 400 })
      });
      container.appendChild(img);

      const items = extractFromDom(container, 'PHOTO_POST');
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe('image');
      expect(items[0].id).toBe('PHOTO_POST');
      expect(items[0].url).toBe('https://instagram.fna.fbcdn.net/photo1.jpg');
    });
  });

  describe('matchesShortcode isolation', () => {
    it('returns true only when element belongs to the target shortcode', () => {
      const articleA = document.createElement('article');
      const linkA = document.createElement('a');
      linkA.href = 'https://www.instagram.com/p/CODE_A/';
      articleA.appendChild(linkA);

      const articleB = document.createElement('article');
      const linkB = document.createElement('a');
      linkB.href = 'https://www.instagram.com/p/CODE_B/';
      articleB.appendChild(linkB);

      document.body.appendChild(articleA);
      document.body.appendChild(articleB);

      // Even if window.location.pathname happens to be /p/CODE_A/
      window.history.pushState({}, '', '/p/CODE_A/');

      // articleA matches CODE_A
      expect(matchesShortcode(articleA, 'CODE_A')).toBe(true);

      // articleB MUST NOT match CODE_A just because window.location has CODE_A!
      expect(matchesShortcode(articleB, 'CODE_A')).toBe(false);

      // articleB matches CODE_B
      expect(matchesShortcode(articleB, 'CODE_B')).toBe(true);
    });
  });

  describe('extractMediaFromFiber targetShortcode isolation', () => {
    it('only returns media when fiber candidate post matches targetShortcode', () => {
      const container = document.createElement('article');

      // Create a mock fiber node on container
      const mockPostA = {
        code: 'POST_A',
        user: { username: 'creator_a' },
        video_versions: [{ url: 'https://cdn.instagram.com/video_a.mp4', width: 720, height: 1280 }]
      };

      (container as any).__reactFiber$test = {
        memoizedProps: {
          post: mockPostA
        },
        return: null
      };

      // Requesting with matching shortcode
      const itemsA = extractMediaFromFiber(container, 'POST_A');
      expect(itemsA).not.toBeNull();
      expect(itemsA?.[0].id).toBe('POST_A');

      // Requesting with mismatched shortcode must NOT return post A
      const itemsB = extractMediaFromFiber(container, 'POST_B');
      expect(itemsB).toBeNull();
    });
  });
});
