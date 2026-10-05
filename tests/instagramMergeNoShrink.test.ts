import { describe, it, expect } from 'vitest';
import { mergeMediaItems } from '../src/shared/mergeMedia';
import type { ExtractedMediaItem } from '../src/shared/types';

/**
 * Regression test for the AGENTS.md invariant:
 *   "mediaCache merges, never overwrites (src/shared/mergeMedia.ts):
 *    a later partial intercept must not wipe resolved slides."
 *
 * The Instagram injector's API-refetch path (fetchInstagramPostJson) did
 * `items = fetchedItems; mediaCache.set(shortcode, items)` with no length guard
 * and no merge. Both refetch endpoints (?__a=1 and the graphql doc_id) are
 * best-effort and often return only the permalink's own media, so a click whose
 * fiber scan had already resolved 5 slides could silently drop to 3.
 */

function slide(code: string): ExtractedMediaItem {
  return {
    id: 'SHORTCODE1',
    platform: 'instagram',
    author: 'tester',
    url: `https://cdninstagram.com/${code}.jpg`,
    type: 'image',
    ext: '.jpg',
    index: 1,
    total: 1,
  };
}

describe('mergeMediaItems never shrinks the held set', () => {
  it('keeps existing slides when a later refetch returns fewer', () => {
    const cached = [slide('a'), slide('b'), slide('c'), slide('d'), slide('e')];
    const refetched = [slide('a')]; // refetch only saw the permalink's own media

    const merged = mergeMediaItems(cached, refetched);

    expect(merged).toHaveLength(5);
    expect(merged.map((m) => m.url)).toContain('https://cdninstagram.com/e.jpg');
  });

  it('adds newly discovered slides from the refetch', () => {
    const cached = [slide('a'), slide('b')];
    const refetched = [slide('a'), slide('b'), slide('c'), slide('d')];

    const merged = mergeMediaItems(cached, refetched);

    expect(merged).toHaveLength(4);
  });

  it('renumbers total so it matches the held set (filename templates depend on it)', () => {
    const cached = [slide('a'), slide('b'), slide('c')];
    const refetched = [slide('a')];

    const merged = mergeMediaItems(cached, refetched);

    // total always tracks what we actually hold -- a stale parser-provided
    // total must not survive a merge that changed the set size.
    expect(merged.every((m) => m.total === 3)).toBe(true);
  });

  it('assigns sequential indices to items that arrive without one', () => {
    const bare = (code: string): ExtractedMediaItem => ({
      id: 'SHORTCODE1',
      platform: 'instagram',
      author: 'tester',
      url: `https://cdninstagram.com/${code}.jpg`,
      type: 'image',
      ext: '.jpg',
    } as ExtractedMediaItem);

    const merged = mergeMediaItems([bare('a'), bare('b'), bare('c')], []);

    expect(merged.map((m) => m.index)).toEqual([1, 2, 3]);
    expect(merged.every((m) => m.total === 3)).toBe(true);
  });

  it('is a no-op when the refetch returns nothing useful', () => {
    const cached = [slide('a'), slide('b')];
    const merged = mergeMediaItems(cached, []);
    expect(merged).toHaveLength(2);
  });
});