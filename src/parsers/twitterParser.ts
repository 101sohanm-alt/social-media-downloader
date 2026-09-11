import { MediaItem, PostMetadata, MediaQuality } from '../shared/types';

/**
 * Transforms a Twitter media image URL into a specific named variant (e.g. name=small, name=large, name=orig).
 */
export function extractTwimgVariant(url: string, nameVariant: string = 'orig'): string {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('twimg.com')) {
      return url;
    }

    const matchExt = parsed.pathname.match(/\.(jpg|jpeg|png|webp)$/i);
    if (matchExt) {
      const ext = matchExt[1].toLowerCase();
      const basePath = parsed.pathname.slice(0, matchExt.index);
      return `${parsed.origin}${basePath}?format=${ext}&name=${nameVariant}`;
    }

    if (parsed.searchParams.has('format')) {
      parsed.searchParams.set('name', nameVariant);
      return parsed.toString();
    }

    parsed.searchParams.set('name', nameVariant);
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Transforms a Twitter media image URL into its highest resolution version (name=orig).
 */
export function extractOriginalTwimgUrl(url: string): string {
  return extractTwimgVariant(url, 'orig');
}

/**
 * Helper to get original twimg URL and its extension.
 */
export function toOrigTwimgUrl(url: string): { url: string; ext: string } {
  const orig = extractOriginalTwimgUrl(url);
  let ext = 'jpg';
  try {
    const parsed = new URL(orig);
    ext = parsed.searchParams.get('format') || 'jpg';
  } catch {
    // default
  }
  return { url: orig, ext };
}

/**
 * Recursively searches an object to collect all Tweet nodes in GraphQL, timeline, or feed responses.
 */
function traverseTweetNodes(obj: any, visited: Set<any>): any[] {
  if (!obj || typeof obj !== 'object') return [];
  if (visited.has(obj)) return [];
  visited.add(obj);

  const results: any[] = [];

  const isTweetNode =
    obj.__typename === 'Tweet' ||
    obj.__typename === 'TweetWithVisibilityResults' ||
    Boolean(obj.legacy && (obj.legacy.extended_entities || obj.legacy.id_str || obj.legacy.full_text)) ||
    Boolean(obj.extended_entities && obj.extended_entities.media) ||
    Boolean(obj.mediaDetails && Array.isArray(obj.mediaDetails)) ||
    Boolean(obj.photos && Array.isArray(obj.photos)) ||
    Boolean(obj.video && obj.video.variants);

  if (isTweetNode) {
    const tweet = obj.tweet || obj;
    results.push(tweet);
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      results.push(...traverseTweetNodes(item, visited));
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (isTweetNode && (key === 'legacy' || key === 'tweet')) {
        continue;
      }
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        results.push(...traverseTweetNodes(obj[key], visited));
      }
    }
  }

  return results;
}

export function collectAllTweetNodes(obj: any): any[] {
  const nodes = traverseTweetNodes(obj, new Set());
  const deduped: any[] = [];
  const seenIds = new Set<string>();

  for (const node of nodes) {
    const id = node.rest_id || node.legacy?.id_str || node.id_str;
    if (id) {
      if (!seenIds.has(id)) {
        seenIds.add(id);
        deduped.push(node);
      }
    } else {
      deduped.push(node);
    }
  }

  return deduped;
}

function findTweetNode(obj: any): any {
  const nodes = collectAllTweetNodes(obj);
  return nodes.length > 0 ? nodes[0] : null;
}

/**
 * Parses a Twitter tweet payload into PostMetadata.
 */
export function parseTwitterTweet(rawTweet: any): PostMetadata | null {
  if (!rawTweet) return null;

  const tweet =
    rawTweet.tweet ||
    (rawTweet.__typename === 'Tweet' ||
    rawTweet.legacy ||
    rawTweet.mediaDetails ||
    rawTweet.photos ||
    rawTweet.video
      ? rawTweet
      : findTweetNode(rawTweet) || rawTweet);

  const legacy = tweet.legacy || tweet;

  const userResults = tweet.core?.user_results?.result;
  const author =
    userResults?.legacy?.screen_name ||
    userResults?.core?.screen_name ||
    legacy?.user?.screen_name ||
    legacy?.screen_name ||
    tweet?.user?.screen_name ||
    tweet?.screen_name ||
    rawTweet?.user?.screen_name ||
    rawTweet?.screen_name ||
    'twitter_user';

  const id =
    tweet.rest_id ||
    legacy?.id_str ||
    tweet.id_str ||
    rawTweet?.id_str ||
    String(Date.now());

  const caption =
    legacy?.full_text ||
    tweet.note_tweet?.note_tweet_results?.result?.text ||
    tweet.text ||
    legacy?.text ||
    rawTweet?.text ||
    '';

  let mediaList =
    legacy?.extended_entities?.media ||
    tweet.extended_entities?.media ||
    rawTweet?.extended_entities?.media ||
    tweet.mediaDetails ||
    rawTweet?.mediaDetails;

  if (!Array.isArray(mediaList) || mediaList.length === 0) {
    const syntheticMedia: any[] = [];
    const photos = tweet.photos || rawTweet?.photos;
    if (Array.isArray(photos)) {
      photos.forEach((p: any, idx: number) => {
        syntheticMedia.push({
          id_str: `${id}_photo_${idx + 1}`,
          type: 'photo',
          media_url_https: p.url,
          original_info: { width: p.width, height: p.height },
        });
      });
    }

    const video = tweet.video || rawTweet?.video;
    if (video && Array.isArray(video.variants)) {
      syntheticMedia.push({
        id_str: `${id}_video_1`,
        type: 'video',
        media_url_https: photos?.[0]?.url || '',
        video_info: {
          variants: video.variants.map((v: any) => ({
            bitrate: v.bitrate,
            content_type:
              v.type ||
              v.content_type ||
              (v.src?.includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp4'),
            url: v.src || v.url,
          })),
        },
      });
    }

    if (syntheticMedia.length > 0) {
      mediaList = syntheticMedia;
    }
  }

  if (!Array.isArray(mediaList) || mediaList.length === 0) {
    return null;
  }

  const media: MediaItem[] = [];
  const total = mediaList.length;

  for (let i = 0; i < total; i++) {
    const item = mediaList[i];
    const type = item.type;

    if (type === 'photo') {
      const baseRawUrl = item.media_url_https || item.media_url || item.url;
      const originalUrl = extractOriginalTwimgUrl(baseRawUrl);
      const thumbUrl = extractTwimgVariant(baseRawUrl, 'small');
      let ext = 'jpg';
      try {
        const urlObj = new URL(originalUrl);
        ext = urlObj.searchParams.get('format') || 'jpg';
      } catch {
        // default jpg
      }

      const qualities: MediaQuality[] = [];
      qualities.push({
        label: item.original_info?.width ? `${item.original_info.width}x${item.original_info.height} (Orig)` : 'Original',
        url: originalUrl,
        width: item.original_info?.width || item.sizes?.large?.w,
        height: item.original_info?.height || item.sizes?.large?.h
      });

      if (item.sizes) {
        if (item.sizes.large) {
          qualities.push({
            label: `${item.sizes.large.w}x${item.sizes.large.h} (Large)`,
            url: extractTwimgVariant(baseRawUrl, 'large'),
            width: item.sizes.large.w,
            height: item.sizes.large.h
          });
        }
        if (item.sizes.medium) {
          qualities.push({
            label: `${item.sizes.medium.w}x${item.sizes.medium.h} (Medium)`,
            url: extractTwimgVariant(baseRawUrl, 'medium'),
            width: item.sizes.medium.w,
            height: item.sizes.medium.h
          });
        }
        if (item.sizes.small) {
          qualities.push({
            label: `${item.sizes.small.w}x${item.sizes.small.h} (Small)`,
            url: extractTwimgVariant(baseRawUrl, 'small'),
            width: item.sizes.small.w,
            height: item.sizes.small.h
          });
        }
      }

      media.push({
        id,
        platform: 'twitter',
        author,
        url: originalUrl,
        type: 'image',
        extension: ext,
        ext: `.${ext}`,
        width: item.original_info?.width || item.sizes?.large?.w,
        height: item.original_info?.height || item.sizes?.large?.h,
        index: i + 1,
        total,
        thumbnailUrl: thumbUrl,
        qualities: qualities.length > 0 ? qualities : undefined
      });
    } else if (type === 'video' || type === 'animated_gif') {
      const rawVariants = item.video_info?.variants || item.video?.variants || [];
      const mp4Variants = rawVariants
        .map((v: any) => ({
          bitrate: v.bitrate,
          content_type: v.content_type || v.type || 'video/mp4',
          url: v.url || v.src,
        }))
        .filter(
          (v: any) =>
            (v.content_type === 'video/mp4' || (typeof v.url === 'string' && v.url.endsWith('.mp4'))) &&
            typeof v.url === 'string' &&
            !v.url.includes('.m3u8')
        );

      if (mp4Variants.length > 0) {
        // Sort descending by bitrate
        mp4Variants.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
        const best = mp4Variants[0];
        const thumbUrl = item.media_url_https || item.media_url;

        const qualities = mp4Variants.map((v: any) => {
          const match = v.url.match(/\/(\d+x\d+)\//);
          const dim = match ? match[1] : undefined;
          let width: number | undefined;
          let height: number | undefined;
          if (dim) {
            const parts = dim.split('x').map(Number);
            width = parts[0];
            height = parts[1];
          }
          const label = dim || (v.bitrate ? `${Math.round(v.bitrate / 1000)}k` : 'MP4');
          return {
            label,
            url: v.url,
            bitrate: v.bitrate,
            width,
            height
          };
        });

        media.push({
          id,
          platform: 'twitter',
          author,
          url: best.url,
          type: type === 'animated_gif' ? 'gif' : 'video',
          extension: 'mp4',
          ext: '.mp4',
          bitrate: best.bitrate,
          width: item.original_info?.width,
          height: item.original_info?.height,
          index: i + 1,
          total,
          thumbnailUrl: thumbUrl,
          qualities
        });
      }
    }
  }

  if (media.length === 0) return null;

  return {
    id,
    platform: 'twitter',
    author,
    caption,
    media,
    timestamp: legacy?.created_at ? new Date(legacy.created_at).getTime() : Date.now(),
  };
}

/**
 * Pure parser that returns an array of MediaItem directly from Twitter data.
 */
export function parseTwitterMedia(raw: any): MediaItem[] {
  if (!raw) return [];

  // 1. Handle direct syndication API response or single tweet with syndication/mediaDetails
  if (raw.mediaDetails || raw.photos || raw.video?.variants) {
    const post = parseTwitterTweet(raw);
    if (post && post.media.length > 0) {
      return post.media;
    }
  }

  // 2. Collect all tweet nodes from GraphQL tree / timeline / feed responses
  const tweetNodes = collectAllTweetNodes(raw);
  const items: MediaItem[] = [];

  for (const node of tweetNodes) {
    const post = parseTwitterTweet(node);
    if (post && post.media.length > 0) {
      items.push(...post.media);
    }
  }

  // 3. Fallback: parse raw directly if collectAllTweetNodes found nothing
  if (items.length === 0) {
    const directPost = parseTwitterTweet(raw);
    if (directPost && directPost.media.length > 0) {
      return directPost.media;
    }
  }

  return items;
}
