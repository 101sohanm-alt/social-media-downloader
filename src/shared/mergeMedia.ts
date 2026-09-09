import { ExtractedMediaItem } from './types';

/**
 * Score how "rich" a record is so merges keep the most useful copy of a slide.
 */
function richness(item: ExtractedMediaItem): number {
  let score = 0;
  if (item.thumbnailUrl) score += 2;
  if (item.qualities && item.qualities.length > 0) score += 1;
  if (item.author && item.author !== 'instagram_user' && item.author !== 'twitter_user' && item.author !== 'reddit_user') score += 1;
  if (item.width && item.height) score += 1;
  return score;
}

/**
 * Union two item lists by media URL. The merged set never shrinks: slides
 * seen before are kept even when a later (partial) dispatch omits them.
 * Order is stable (existing first) and index/total are renumbered so the
 * picker and filename templates stay consistent.
 */
export function mergeMediaItems(
  existing: ExtractedMediaItem[],
  incoming: ExtractedMediaItem[]
): ExtractedMediaItem[] {
  const byUrl = new Map<string, ExtractedMediaItem>();
  for (const item of [...(existing || []), ...(incoming || [])]) {
    if (!item || typeof item.url !== 'string' || item.url.length === 0) continue;
    const prev = byUrl.get(item.url);
    if (!prev) {
      byUrl.set(item.url, item);
    } else if (richness(item) > richness(prev)) {
      byUrl.set(item.url, { ...item });
    }
  }
  const merged = [...byUrl.values()];
  return merged.map((item, i) => ({
    ...item,
    index: item.index ?? i + 1,
    // Total always reflects what we actually hold; a stale parser-provided
    // total must not survive a merge that changed the set size.
    total: item.total === merged.length ? item.total : merged.length
  }));
}
