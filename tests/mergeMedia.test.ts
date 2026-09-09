import { describe, it, expect } from 'vitest';
import { mergeMediaItems } from '../src/shared/mergeMedia';
import { ExtractedMediaItem } from '../src/shared/types';

function item(url: string, extra: Partial<ExtractedMediaItem> = {}): ExtractedMediaItem {
  return { id: 'p1', platform: 'instagram', type: 'image', url, ...extra };
}

describe('mergeMediaItems', () => {
  it('unions disjoint sets and renumbers sequentially', () => {
    const merged = mergeMediaItems(
      [item('https://cdn.example.com/1.jpg')],
      [item('https://cdn.example.com/2.jpg'), item('https://cdn.example.com/3.jpg')]
    );
    expect(merged.map((m) => m.url)).toEqual([
      'https://cdn.example.com/1.jpg',
      'https://cdn.example.com/2.jpg',
      'https://cdn.example.com/3.jpg'
    ]);
    expect(merged.map((m) => m.index)).toEqual([1, 2, 3]);
    expect(merged.every((m) => m.total === 3)).toBe(true);
  });

  it('never shrinks: a partial incoming set keeps previously seen slides', () => {
    const full = [
      item('https://cdn.example.com/1.jpg'),
      item('https://cdn.example.com/2.jpg'),
      item('https://cdn.example.com/3.jpg'),
      item('https://cdn.example.com/4.jpg')
    ];
    const merged = mergeMediaItems(full, [item('https://cdn.example.com/1.jpg')]);
    expect(merged).toHaveLength(4);
  });

  it('dedupes by URL and keeps the richer record', () => {
    const merged = mergeMediaItems(
      [item('https://cdn.example.com/1.jpg')],
      [item('https://cdn.example.com/1.jpg', { thumbnailUrl: 'https://cdn.example.com/t1.jpg', width: 1080, height: 1080 })]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].thumbnailUrl).toBe('https://cdn.example.com/t1.jpg');
    expect(merged[0].width).toBe(1080);
  });

  it('skips items without a URL', () => {
    const merged = mergeMediaItems(
      [item('https://cdn.example.com/1.jpg')],
      [{ id: 'p1', platform: 'instagram', type: 'image', url: '' }]
    );
    expect(merged).toHaveLength(1);
  });
});
