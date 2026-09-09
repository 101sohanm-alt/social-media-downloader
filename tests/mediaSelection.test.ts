import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseInstagramMedia } from '../src/parsers/instagramParser';
import { parseRedditMedia } from '../src/parsers/redditParser';
import { parseTwitterMedia } from '../src/parsers/twitterParser';
import { ExtractedMediaItem } from '../src/shared/types';
import { setupInstagramInjector } from '../src/content/platforms/instagram';
import { setupTwitterInjector } from '../src/content/platforms/twitter';
import { setupRedditInjector } from '../src/content/platforms/reddit';
import { normalizeBatchItems } from '../src/background/index';

describe('Multi-Media Selection & Qualities - Parsers', () => {
  it('Instagram: extracts thumbnailUrl and multiple qualities for carousel and videos', () => {
    const mockCarousel = {
      id: 'ig_multi_1',
      code: 'Shortcode1',
      user: { username: 'creator' },
      carousel_media_count: 2,
      carousel_media: [
        {
          id: 'c1',
          image_versions2: {
            candidates: [
              { width: 1080, height: 1080, url: 'https://cdn.instagram.com/1080.jpg' },
              { width: 640, height: 640, url: 'https://cdn.instagram.com/640.jpg' },
              { width: 150, height: 150, url: 'https://cdn.instagram.com/150.jpg' },
            ],
          },
        },
        {
          id: 'c2',
          image_versions2: {
            candidates: [
              { width: 720, height: 720, url: 'https://cdn.instagram.com/video_thumb.jpg' },
            ],
          },
          video_versions: [
            { width: 1080, height: 1080, url: 'https://cdn.instagram.com/1080.mp4' },
            { width: 720, height: 720, url: 'https://cdn.instagram.com/720.mp4' },
          ],
        },
      ],
    };

    const items = parseInstagramMedia(mockCarousel);
    expect(items).toHaveLength(2);

    // Item 1 (Image)
    expect(items[0].thumbnailUrl).toBeDefined();
    expect(items[0].qualities).toBeDefined();
    expect(items[0].qualities!.length).toBeGreaterThanOrEqual(2);

    // Item 2 (Video)
    expect(items[1].thumbnailUrl).toBe('https://cdn.instagram.com/video_thumb.jpg');
    expect(items[1].qualities).toBeDefined();
    expect(items[1].qualities!.length).toBeGreaterThanOrEqual(2);
    expect(items[1].qualities![0].label).toContain('1080');
    expect(items[1].qualities![1].label).toContain('720');
  });

  it('Reddit: extracts thumbnailUrl and qualities for gallery items and DASH video', () => {
    const mockGallery = {
      kind: 't3',
      data: {
        id: 'gal_123',
        author: 'photographer',
        title: 'Gallery post',
        is_gallery: true,
        gallery_data: {
          items: [{ media_id: 'm1' }],
        },
        media_metadata: {
          m1: {
            status: 'valid',
            e: 'Image',
            m: 'image/jpg',
            p: [
              { u: 'https://preview.redd.it/m1_small.jpg', x: 320, y: 240 },
              { u: 'https://preview.redd.it/m1_med.jpg', x: 640, y: 480 },
            ],
            s: {
              u: 'https://preview.redd.it/m1_full.jpg',
              x: 1920,
              y: 1080,
            },
          },
        },
      },
    };

    const galleryItems = parseRedditMedia(mockGallery);
    expect(galleryItems).toHaveLength(1);
    expect(galleryItems[0].thumbnailUrl).toBe('https://preview.redd.it/m1_small.jpg');
    expect(galleryItems[0].qualities).toBeDefined();
    expect(galleryItems[0].qualities!.length).toBeGreaterThanOrEqual(2);

    const mockVideo = {
      kind: 't3',
      data: {
        id: 'vid_123',
        author: 'director',
        title: 'Video post',
        is_video: true,
        preview: {
          images: [
            {
              source: { url: 'https://preview.redd.it/vid_thumb.jpg', width: 1920, height: 1080 },
            },
          ],
        },
        media: {
          reddit_video: {
            fallback_url: 'https://v.redd.it/abc/DASH_1080.mp4?source=fallback',
            height: 1080,
            width: 1920,
            duration: 30,
            has_audio: true,
          },
        },
      },
    };

    const videoItems = parseRedditMedia(mockVideo);
    expect(videoItems).toHaveLength(1);
    expect(videoItems[0].thumbnailUrl).toBe('https://preview.redd.it/vid_thumb.jpg');
    expect(videoItems[0].qualities).toBeDefined();
    expect(videoItems[0].qualities!.some((q) => q.label.includes('1080'))).toBe(true);
    expect(videoItems[0].qualities!.some((q) => q.label.includes('720'))).toBe(true);
  });

  it('Twitter: extracts thumbnailUrl and qualities for multi-photo and video tweets', () => {
    const mockTweet = {
      legacy: {
        id_str: 'tweet_123',
        user: { screen_name: 'artist' },
        full_text: 'My latest drawings',
        extended_entities: {
          media: [
            {
              type: 'photo',
              media_url_https: 'https://pbs.twimg.com/media/pic1.jpg',
              sizes: {
                thumb: { w: 150, h: 150 },
                small: { w: 680, h: 680 },
                large: { w: 2048, h: 2048 },
              },
            },
            {
              type: 'video',
              media_url_https: 'https://pbs.twimg.com/media/video_thumb.jpg',
              video_info: {
                variants: [
                  { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/vid_1080.mp4' },
                  { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/vid_720.mp4' },
                ],
              },
            },
          ],
        },
      },
    };

    const items = parseTwitterMedia(mockTweet);
    expect(items).toHaveLength(2);

    // Photo
    expect(items[0].thumbnailUrl).toBeDefined();
    expect(items[0].qualities).toBeDefined();

    // Video
    expect(items[1].thumbnailUrl).toBe('https://pbs.twimg.com/media/video_thumb.jpg');
    expect(items[1].qualities).toBeDefined();
    expect(items[1].qualities!.length).toBe(2);
    expect(items[1].qualities![0].bitrate).toBe(2176000);
  });
});

describe('Direct Bulk Downloads (No Modal)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('Instagram: multi-media post directly invokes requestDownload with forceAll: true and without modal', async () => {
    const container = document.createElement('article');
    const link = document.createElement('a');
    link.href = 'https://www.instagram.com/p/TEST_IG_CODE/';
    container.appendChild(link);

    const shareBtn = document.createElement('button');
    shareBtn.setAttribute('aria-label', 'Share Post');
    container.appendChild(shareBtn);

    document.body.appendChild(container);

    const mockItems: ExtractedMediaItem[] = [
      { id: 'TEST_IG_CODE', platform: 'instagram', type: 'image', url: 'https://cdn.instagram.com/1.jpg' },
      { id: 'TEST_IG_CODE', platform: 'instagram', type: 'image', url: 'https://cdn.instagram.com/2.jpg' },
    ];
    const mediaCache = new Map<string, ExtractedMediaItem[]>();
    mediaCache.set('TEST_IG_CODE', mockItems);

    const requestDownloadMock = vi.fn().mockResolvedValue(true);
    setupInstagramInjector(mediaCache, requestDownloadMock);

    const dlBtn = container.querySelector('.soc-dl-btn') as HTMLButtonElement;
    expect(dlBtn).not.toBeNull();

    dlBtn.click();
    await vi.waitFor(() => {
      expect(requestDownloadMock).toHaveBeenCalledTimes(1);
    });

    expect(requestDownloadMock).toHaveBeenCalledWith(mockItems, { forceAll: true });
    expect(document.querySelector('.soc-selection-modal')).toBeNull();
    expect(document.querySelector('.soc-modal-backdrop')).toBeNull();
  });

  it('Twitter: multi-media tweet directly invokes requestDownload with forceAll: true and without modal', async () => {
    const tweet = document.createElement('article');
    tweet.setAttribute('data-testid', 'tweet');
    const group = document.createElement('div');
    group.setAttribute('role', 'group');
    tweet.appendChild(group);

    const link = document.createElement('a');
    link.href = 'https://twitter.com/user/status/987654321';
    tweet.appendChild(link);
    document.body.appendChild(tweet);

    const mockItems: ExtractedMediaItem[] = [
      { id: '987654321', platform: 'twitter', type: 'image', url: 'https://pbs.twimg.com/media/1.jpg' },
      { id: '987654321', platform: 'twitter', type: 'image', url: 'https://pbs.twimg.com/media/2.jpg' },
    ];
    const mediaCache = new Map<string, ExtractedMediaItem[]>();
    mediaCache.set('987654321', mockItems);

    const requestDownloadMock = vi.fn().mockResolvedValue(true);
    setupTwitterInjector(mediaCache, requestDownloadMock);

    const dlBtn = group.querySelector('.soc-dl-btn') as HTMLButtonElement;
    expect(dlBtn).not.toBeNull();

    dlBtn.click();
    await vi.waitFor(() => {
      expect(requestDownloadMock).toHaveBeenCalledTimes(1);
    });

    expect(requestDownloadMock).toHaveBeenCalledWith(mockItems, { forceAll: true });
    expect(document.querySelector('.soc-selection-modal')).toBeNull();
    expect(document.querySelector('.soc-modal-backdrop')).toBeNull();
  });

  it('Reddit: multi-media gallery directly invokes requestDownload with forceAll: true and without modal', async () => {
    const post = document.createElement('shreddit-post');
    post.setAttribute('id', 't3_red_gallery');
    const actionRow = document.createElement('div');
    actionRow.setAttribute('slot', 'action-row');
    post.appendChild(actionRow);
    document.body.appendChild(post);

    const mockItems: ExtractedMediaItem[] = [
      { id: 'red_gallery', platform: 'reddit', type: 'image', url: 'https://preview.redd.it/1.jpg' },
      { id: 'red_gallery', platform: 'reddit', type: 'image', url: 'https://preview.redd.it/2.jpg' },
    ];
    const mediaCache = new Map<string, ExtractedMediaItem[]>();
    mediaCache.set('red_gallery', mockItems);

    const requestDownloadMock = vi.fn().mockResolvedValue(true);
    setupRedditInjector(mediaCache, requestDownloadMock);

    const dlBtn = actionRow.querySelector('.soc-dl-btn') as HTMLButtonElement;
    expect(dlBtn).not.toBeNull();

    dlBtn.click();
    await vi.waitFor(() => {
      expect(requestDownloadMock).toHaveBeenCalledTimes(1);
    });

    expect(requestDownloadMock).toHaveBeenCalledWith(mockItems, { forceAll: true });
    expect(document.querySelector('.soc-selection-modal')).toBeNull();
    expect(document.querySelector('.soc-modal-backdrop')).toBeNull();
  });

  it('Normalizes multi-media batch items with sequential index and total tokens', () => {
    const rawBatch: ExtractedMediaItem[] = [
      { id: 'batch_1', platform: 'instagram', type: 'image', url: 'https://cdn.example.com/1.jpg' },
      { id: 'batch_1', platform: 'instagram', type: 'image', url: 'https://cdn.example.com/2.jpg' },
      { id: 'batch_1', platform: 'instagram', type: 'video', url: 'https://cdn.example.com/3.mp4' },
    ];

    const normalized = normalizeBatchItems(rawBatch);
    expect(normalized).toHaveLength(3);
    expect(normalized[0].index).toBe(1);
    expect(normalized[0].total).toBe(3);
    expect(normalized[1].index).toBe(2);
    expect(normalized[1].total).toBe(3);
    expect(normalized[2].index).toBe(3);
    expect(normalized[2].total).toBe(3);

    // Preserves existing index/total if already set
    const partialBatch: ExtractedMediaItem[] = [
      { id: 'batch_2', platform: 'twitter', type: 'image', url: 'https://cdn.example.com/a.jpg', index: 5, total: 10 },
      { id: 'batch_2', platform: 'twitter', type: 'image', url: 'https://cdn.example.com/b.jpg' },
    ];
    const partialNormalized = normalizeBatchItems(partialBatch);
    expect(partialNormalized[0].index).toBe(5);
    expect(partialNormalized[0].total).toBe(10);
    expect(partialNormalized[1].index).toBe(2);
    expect(partialNormalized[1].total).toBe(2);
  });
});

