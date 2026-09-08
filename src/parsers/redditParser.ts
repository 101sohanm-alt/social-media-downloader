import { ExtractedMediaItem, MediaQuality } from '../shared/types';
import { resolveRedditDashAudioUrl } from '../shared/dashResolver';

function unescapeUrl(url: string): string {
  return url.replace(/&amp;/g, '&');
}

function parseSinglePostData(post: any): ExtractedMediaItem[] {
  if (!post || typeof post !== 'object') return [];

  const id = post.id || String(Date.now());
  const author = post.author || 'reddit_user';
  const title = post.title || '';
  const results: ExtractedMediaItem[] = [];

  // 1. Hosted Video (v.redd.it)
  const redditVideo = post.media?.reddit_video || post.secure_media?.reddit_video;
  if (redditVideo && redditVideo.fallback_url) {
    const fallbackUrl = redditVideo.fallback_url;
    const isGif = Boolean(redditVideo.is_gif);
    const hasAudio = redditVideo.has_audio !== false && !isGif;
    const audioUrl = hasAudio ? resolveRedditDashAudioUrl(fallbackUrl) || undefined : undefined;

    const qualities: MediaQuality[] = [];
    const matchDash = fallbackUrl.match(/DASH_(\d+)\.mp4/);
    if (matchDash) {
      const standardResolutions = [1080, 720, 480, 360, 240];
      for (const res of standardResolutions) {
        if (redditVideo.height && res > redditVideo.height) continue;
        qualities.push({
          label: `${res}p`,
          url: fallbackUrl.replace(/DASH_\d+\.mp4/, `DASH_${res}.mp4`),
          height: res,
          width: redditVideo.width && redditVideo.height ? Math.round((redditVideo.width / redditVideo.height) * res) : undefined
        });
      }
    }
    if (qualities.length === 0) {
      qualities.push({
        label: redditVideo.height ? `${redditVideo.height}p` : 'Video',
        url: fallbackUrl,
        width: redditVideo.width,
        height: redditVideo.height
      });
    }

    const thumb = post.thumbnail && post.thumbnail.startsWith('http')
      ? post.thumbnail
      : (post.preview?.images?.[0]?.source?.url ? unescapeUrl(post.preview.images[0].source.url) : undefined);

    results.push({
      id,
      platform: 'reddit',
      type: isGif ? 'gif' : 'video',
      author,
      title,
      url: fallbackUrl,
      ext: '.mp4',
      width: redditVideo.width,
      height: redditVideo.height,
      audioUrl,
      isDashMuxRequired: hasAudio,
      thumbnailUrl: thumb,
      qualities
    });
    return results;
  }

  // 2. Gallery
  if (post.is_gallery && post.media_metadata) {
    const items = post.gallery_data?.items || [];
    const mediaIds = items.length > 0 ? items.map((i: any) => i.media_id) : Object.keys(post.media_metadata);
    const total = mediaIds.length;

    mediaIds.forEach((mediaId: string, idx: number) => {
      const meta = post.media_metadata[mediaId];
      if (!meta) return;

      const rawUrl = meta.s?.u || meta.s?.gif || meta.s?.mp4;
      if (!rawUrl) return;

      const cleanUrl = unescapeUrl(rawUrl);
      const isVideo = meta.e === 'RedditVideo' || cleanUrl.includes('.mp4');
      const isGif = meta.e === 'AnimatedImage' || cleanUrl.includes('.gif');

      let ext = '.jpg';
      if (meta.m) {
        ext = `.${meta.m.replace('image/', '').toLowerCase()}`;
      } else if (cleanUrl.match(/\.(png|jpg|jpeg|gif|mp4|webp)/i)) {
        const m = cleanUrl.match(/\.(png|jpg|jpeg|gif|mp4|webp)/i);
        if (m) ext = `.${m[1].toLowerCase()}`;
      }

      const qualities: MediaQuality[] = [];
      if (Array.isArray(meta.p)) {
        meta.p.forEach((p: any) => {
          if (p.u) {
            qualities.push({
              label: `${p.x}x${p.y}`,
              url: unescapeUrl(p.u),
              width: p.x,
              height: p.y
            });
          }
        });
      }
      qualities.unshift({
        label: meta.s?.x && meta.s?.y ? `${meta.s.x}x${meta.s.y} (Original)` : 'Original',
        url: cleanUrl,
        width: meta.s?.x,
        height: meta.s?.y
      });

      const thumb = meta.p && meta.p.length > 0
        ? unescapeUrl(meta.p[0].u)
        : cleanUrl;

      results.push({
        id,
        platform: 'reddit',
        type: isVideo ? 'video' : (isGif ? 'gif' : 'image'),
        author,
        title,
        url: cleanUrl,
        ext,
        width: meta.s?.x,
        height: meta.s?.y,
        index: idx + 1,
        total,
        thumbnailUrl: thumb,
        qualities
      });
    });

    return results;
  }

  // 3. Direct Image or external destination
  const targetUrl = post.url_overridden_by_dest || post.url;
  if (targetUrl) {
    const isImageHint = post.post_hint === 'image';
    const isDirectImage = Boolean(targetUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) || targetUrl.includes('i.redd.it'));

    if (isImageHint || isDirectImage) {
      const m = targetUrl.match(/\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i);
      const ext = m ? `.${m[1].toLowerCase()}` : '.jpg';
      const isGif = ext === '.gif';

      const qualities: MediaQuality[] = [];
      const resList = post.preview?.images?.[0]?.resolutions;
      if (Array.isArray(resList)) {
        resList.forEach((r: any) => {
          if (r.url) {
            qualities.push({
              label: `${r.width}x${r.height}`,
              url: unescapeUrl(r.url),
              width: r.width,
              height: r.height
            });
          }
        });
      }
      qualities.unshift({
        label: 'Original',
        url: unescapeUrl(targetUrl)
      });

      const thumb = post.thumbnail && post.thumbnail.startsWith('http')
        ? post.thumbnail
        : (post.preview?.images?.[0]?.resolutions?.[0]?.url ? unescapeUrl(post.preview.images[0].resolutions[0].url) : unescapeUrl(targetUrl));

      results.push({
        id,
        platform: 'reddit',
        type: isGif ? 'gif' : 'image',
        author,
        title,
        url: unescapeUrl(targetUrl),
        ext,
        thumbnailUrl: thumb,
        qualities: qualities.length > 0 ? qualities : undefined
      });
      return results;
    }
  }

  return results;
}

export function parseRedditMedia(raw: any): ExtractedMediaItem[] {
  if (!raw) return [];

  // Array of listings (e.g. /comments/{id}.json response)
  if (Array.isArray(raw)) {
    const allResults: ExtractedMediaItem[] = [];
    for (const item of raw) {
      if (item.kind === 'Listing' && item.data?.children) {
        for (const child of item.data.children) {
          if (child.kind === 't3' && child.data) {
            allResults.push(...parseSinglePostData(child.data));
          }
        }
      } else if (item.kind === 't3' && item.data) {
        allResults.push(...parseSinglePostData(item.data));
      }
    }
    return allResults;
  }

  // Single post wrapped in { kind: 't3', data: ... }
  if (raw.kind === 't3' && raw.data) {
    return parseSinglePostData(raw.data);
  }

  // Single raw post data object
  if (raw.data && (raw.data.url || raw.data.title || raw.data.is_video)) {
    return parseSinglePostData(raw.data);
  }

  return parseSinglePostData(raw);
}
