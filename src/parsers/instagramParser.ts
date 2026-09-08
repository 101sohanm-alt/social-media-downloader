import { ExtractedMediaItem, MediaQuality } from '../shared/types';

function extractBestCandidate(candidates: any[]): { url: string; width: number; height: number } | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => (b.width || b.config_width || 0) - (a.width || a.config_width || 0));
  const best = sorted[0];
  return {
    url: best.url || best.src,
    width: best.width || best.config_width || 0,
    height: best.height || best.config_height || 0
  };
}

function extractQualitiesFromCandidates(candidates: any[]): MediaQuality[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const sorted = [...candidates].sort((a, b) => (b.width || b.config_width || 0) - (a.width || a.config_width || 0));
  return sorted.map((c) => {
    const w = c.width || c.config_width || 0;
    const h = c.height || c.config_height || 0;
    return {
      label: w && h ? `${w}x${h}` : 'Image',
      url: c.url || c.src,
      width: w,
      height: h
    };
  });
}

function extractThumbnailUrl(candidates: any[]): string | undefined {
  if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
  const sorted = [...candidates].sort((a, b) => (a.width || a.config_width || 0) - (b.width || b.config_width || 0));
  const suitable = sorted.find((c) => (c.width || c.config_width || 0) >= 300) || sorted[0];
  return suitable?.url || suitable?.src;
}

function extractQualitiesFromVideos(videoVersions: any[]): MediaQuality[] {
  if (!Array.isArray(videoVersions) || videoVersions.length === 0) return [];
  const sorted = [...videoVersions].sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted.map((v) => {
    const w = v.width || 0;
    const h = v.height || 0;
    return {
      label: h ? `${h}p` : `${w}x${h}`,
      url: v.url,
      width: w,
      height: h
    };
  });
}

export function parseInstagramMedia(raw: any): ExtractedMediaItem[] {
  if (!raw) return [];

  // GraphQL format variations
  const scm = raw.data?.shortcode_media || raw.data?.xdt_shortcode_media || raw.graphql?.shortcode_media;
  if (scm) {
    const author = scm.owner?.username || 'instagram_user';
    const id = scm.shortcode || scm.code || String(Date.now());
    const caption = scm.edge_media_to_caption?.edges?.[0]?.node?.text || '';

    // GraphQL carousel
    if (scm.edge_sidecar_to_children?.edges?.length) {
      const edges = scm.edge_sidecar_to_children.edges;
      const total = edges.length;
      return edges.map((edge: any, idx: number) => {
        const node = edge.node;
        const index = idx + 1;
        if (node.is_video && node.video_url) {
          const thumb = node.display_url || extractThumbnailUrl(node.display_resources);
          return {
            id,
            platform: 'instagram' as const,
            type: 'video' as const,
            author,
            url: node.video_url,
            ext: '.mp4',
            index,
            total,
            width: node.dimensions?.width,
            height: node.dimensions?.height,
            thumbnailUrl: thumb,
            qualities: [
              {
                label: node.dimensions?.height ? `${node.dimensions.height}p` : 'HD',
                url: node.video_url,
                width: node.dimensions?.width,
                height: node.dimensions?.height
              }
            ]
          };
        }
        const best = extractBestCandidate(node.display_resources) || { url: node.display_url, width: 0, height: 0 };
        const thumb = extractThumbnailUrl(node.display_resources) || node.display_url;
        const qualities = extractQualitiesFromCandidates(node.display_resources);
        return {
          id,
          platform: 'instagram' as const,
          type: 'image' as const,
          author,
          url: best.url,
          ext: '.jpg',
          index,
          total,
          width: best.width,
          height: best.height,
          thumbnailUrl: thumb,
          qualities: qualities.length > 0 ? qualities : undefined
        };
      });
    }

    // GraphQL single video
    if (scm.is_video && scm.video_url) {
      return [{
        id,
        platform: 'instagram',
        type: 'video',
        author,
        url: scm.video_url,
        ext: '.mp4',
        width: scm.dimensions?.width,
        height: scm.dimensions?.height,
        thumbnailUrl: scm.display_url,
        qualities: [
          {
            label: scm.dimensions?.height ? `${scm.dimensions.height}p` : 'HD',
            url: scm.video_url,
            width: scm.dimensions?.width,
            height: scm.dimensions?.height
          }
        ]
      }];
    }

    // GraphQL single image
    const best = extractBestCandidate(scm.display_resources) || { url: scm.display_url, width: 0, height: 0 };
    const thumb = extractThumbnailUrl(scm.display_resources) || scm.display_url;
    const qualities = extractQualitiesFromCandidates(scm.display_resources);
    return [{
      id,
      platform: 'instagram',
      type: 'image',
      author,
      url: best.url,
      ext: '.jpg',
      width: best.width,
      height: best.height,
      thumbnailUrl: thumb,
      qualities: qualities.length > 0 ? qualities : undefined
    }];
  }

  // Modern Instagram Web GraphQL responses
  const webInfoItems = raw.data?.xdt_api__v1__media__shortcode__web_info?.items;
  if (Array.isArray(webInfoItems) && webInfoItems.length > 0) {
    return webInfoItems.flatMap((item: any) => parseSingleInstagramItem(item));
  }
  const mediaInfoItems = raw.data?.xdt_api__v1__media_info?.items;
  if (Array.isArray(mediaInfoItems) && mediaInfoItems.length > 0) {
    return mediaInfoItems.flatMap((item: any) => parseSingleInstagramItem(item));
  }

  // Handle arrays of feed items (e.g. /p/{code}/?__a=1&__d=dis or timeline endpoints)
  if (Array.isArray(raw.items) && raw.items.length > 0) {
    return raw.items.flatMap((item: any) => parseSingleInstagramItem(item));
  }
  if (Array.isArray(raw.feed_items) && raw.feed_items.length > 0) {
    return raw.feed_items.flatMap((fi: any) => parseSingleInstagramItem(fi.media_or_ad || fi.media || fi));
  }
  if (Array.isArray(raw.data?.xdt_api__v1__feed__timeline?.edges)) {
    return raw.data.xdt_api__v1__feed__timeline.edges.flatMap((edge: any) => parseSingleInstagramItem(edge.node));
  }
  if (Array.isArray(raw.data?.xdt_api__v1__clips__home__connection?.edges)) {
    return raw.data.xdt_api__v1__clips__home__connection.edges.flatMap((edge: any) => parseSingleInstagramItem(edge.node?.media || edge.node));
  }
  if (Array.isArray(raw.data?.xdt_api__v1__feed__user_timeline_graphql_connection?.edges)) {
    return raw.data.xdt_api__v1__feed__user_timeline_graphql_connection.edges.flatMap((edge: any) => parseSingleInstagramItem(edge.node));
  }

  // Direct single item
  const item = raw.media || raw.item || raw.data?.media || raw;
  return parseSingleInstagramItem(item);
}

function parseSingleInstagramItem(item: any): ExtractedMediaItem[] {
  if (!item) return [];
  const id = item.code || item.shortcode || item.pk || item.id || String(Date.now());
  const author = item.user?.username || item.owner?.username || 'instagram_user';
  const caption = item.caption?.text || '';

  const results: ExtractedMediaItem[] = [];

  // Carousel
  if (Array.isArray(item.carousel_media) && item.carousel_media.length > 0) {
    const total = item.carousel_media_count || item.carousel_media.length;
    item.carousel_media.forEach((cItem: any, idx: number) => {
      const index = idx + 1;
      if (Array.isArray(cItem.video_versions) && cItem.video_versions.length > 0) {
        const sorted = [...cItem.video_versions].sort((a, b) => (b.width || 0) - (a.width || 0));
        const thumb = extractThumbnailUrl(cItem.image_versions2?.candidates) || (cItem.image_versions2?.candidates?.[0]?.url);
        const qualities = extractQualitiesFromVideos(cItem.video_versions);
        results.push({
          id,
          platform: 'instagram',
          type: 'video',
          author,
          url: sorted[0].url,
          ext: '.mp4',
          width: sorted[0].width,
          height: sorted[0].height,
          index,
          total,
          caption,
          thumbnailUrl: thumb,
          qualities
        });
      } else if (cItem.image_versions2?.candidates) {
        const best = extractBestCandidate(cItem.image_versions2.candidates);
        const thumb = extractThumbnailUrl(cItem.image_versions2.candidates);
        const qualities = extractQualitiesFromCandidates(cItem.image_versions2.candidates);
        if (best) {
          results.push({
            id,
            platform: 'instagram',
            type: 'image',
            author,
            url: best.url,
            ext: '.jpg',
            width: best.width,
            height: best.height,
            index,
            total,
            caption,
            thumbnailUrl: thumb || best.url,
            qualities
          });
        }
      }
    });
  }
  // Single Reel or Video
  else if (Array.isArray(item.video_versions) && item.video_versions.length > 0) {
    const sorted = [...item.video_versions].sort((a, b) => (b.width || 0) - (a.width || 0));
    const thumb = extractThumbnailUrl(item.image_versions2?.candidates) || (item.image_versions2?.candidates?.[0]?.url);
    const qualities = extractQualitiesFromVideos(item.video_versions);
    results.push({
      id,
      platform: 'instagram',
      type: 'video',
      author,
      url: sorted[0].url,
      ext: '.mp4',
      width: sorted[0].width,
      height: sorted[0].height,
      caption,
      thumbnailUrl: thumb,
      qualities
    });
  }
  // Single Image
  else if (item.image_versions2?.candidates) {
    const best = extractBestCandidate(item.image_versions2.candidates);
    const thumb = extractThumbnailUrl(item.image_versions2.candidates);
    const qualities = extractQualitiesFromCandidates(item.image_versions2.candidates);
    if (best) {
      results.push({
        id,
        platform: 'instagram',
        type: 'image',
        author,
        url: best.url,
        ext: '.jpg',
        width: best.width,
        height: best.height,
        caption,
        thumbnailUrl: thumb || best.url,
        qualities
      });
    }
  }

  return results;
}

