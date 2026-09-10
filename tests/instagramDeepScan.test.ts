import { describe, it, expect } from 'vitest';
import { parseInstagramMedia, deepScanMediaItems } from '../src/parsers/instagramParser';

function reelItem(code: string) {
  return {
    code,
    user: { username: 'reel_creator' },
    video_versions: [
      { width: 1080, height: 1920, url: `https://cdn.instagram.com/${code}_1080.mp4` },
      { width: 720, height: 1280, url: `https://cdn.instagram.com/${code}_720.mp4` }
    ],
    image_versions2: {
      candidates: [{ width: 1080, height: 1920, url: `https://cdn.instagram.com/${code}_thumb.jpg` }]
    }
  };
}

describe('parseInstagramMedia deep-scan fallback', () => {
  it('recovers a reel from an unknown clips-viewer connection shape', () => {
    const payload = {
      data: {
        xdt_api__v1__clips__viewer__connection: {
          edges: [{ node: { media: reelItem('ReelCode1') } }]
        }
      }
    };
    const items = parseInstagramMedia(payload);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('video');
    expect(items[0].id).toBe('ReelCode1');
    expect(items[0].url).toBe('https://cdn.instagram.com/ReelCode1_1080.mp4');
  });

  it('recovers reels nested under arbitrary user keys', () => {
    const payload = {
      data: {
        some_user_surface: {
          clips: [reelItem('ReelA'), reelItem('ReelB')]
        }
      }
    };
    const items = parseInstagramMedia(payload);
    expect(items.map((i) => i.id).sort()).toEqual(['ReelA', 'ReelB']);
  });

  it('returns [] for payloads with no media-like objects', () => {
    expect(parseInstagramMedia({ data: { viewer: { id: '123' } } })).toEqual([]);
    expect(parseInstagramMedia(null)).toEqual([]);
  });

  it('caps deep-scan results', () => {
    const payload = { clips: Array.from({ length: 40 }, (_, i) => reelItem(`Cap${i}`)) };
    expect(deepScanMediaItems(payload)).toHaveLength(25);
  });

  it('does not duplicate carousel slides as separate items', () => {
    const payload = {
      code: 'Carousel1',
      user: { username: 'creator' },
      carousel_media_count: 2,
      carousel_media: [
        { id: 'c1', image_versions2: { candidates: [{ width: 1080, height: 1080, url: 'https://cdn.instagram.com/c1.jpg' }] } },
        { id: 'c2', image_versions2: { candidates: [{ width: 1080, height: 1080, url: 'https://cdn.instagram.com/c2.jpg' }] } }
      ]
    };
    const items = parseInstagramMedia(payload);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.id === 'Carousel1')).toBe(true);
  });
});
