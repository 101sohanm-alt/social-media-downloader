import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseInstagramMedia } from '../src/parsers/instagramParser';
import { parseRedditMedia } from '../src/parsers/redditParser';
import { parseTwitterMedia } from '../src/parsers/twitterParser';
import { openSelectionModal } from '../src/content/ui/selectionModal';
import { ExtractedMediaItem } from '../src/shared/types';

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

describe('Selection Modal Component (UI)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const mockItems: ExtractedMediaItem[] = [
    {
      id: 'post1',
      platform: 'instagram',
      type: 'image',
      author: 'creator',
      url: 'https://example.com/img1_orig.jpg',
      thumbnailUrl: 'https://example.com/img1_thumb.jpg',
      width: 1080,
      height: 1350,
      index: 1,
      total: 2,
    },
    {
      id: 'post1',
      platform: 'instagram',
      type: 'video',
      author: 'creator',
      url: 'https://example.com/vid2.mp4',
      thumbnailUrl: 'https://example.com/vid2_thumb.jpg',
      width: 720,
      height: 1280,
      index: 2,
      total: 2,
    },
  ];

  it('renders modal with cards, badges, and all items selected by default', () => {
    const onDownload = vi.fn();
    const onClose = vi.fn();

    openSelectionModal({
      items: mockItems,
      postTitle: 'Post by creator',
      onDownload,
      onClose,
    });

    const backdrop = document.querySelector('.soc-modal-backdrop');
    expect(backdrop).not.toBeNull();

    const cards = document.querySelectorAll('.soc-card');
    expect(cards).toHaveLength(2);

    // Checkboxes checked by default
    const checkboxes = document.querySelectorAll<HTMLInputElement>('.soc-card-checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(true);

    // Badges
    const badges = document.querySelectorAll('.soc-badge-index');
    expect(badges).toHaveLength(2);
    expect(badges[0].textContent).toBe('#1');
    expect(badges[1].textContent).toBe('#2');

    // Type tags
    const typeTags = document.querySelectorAll('.soc-badge-type');
    expect(typeTags[0].textContent).toBe('IMAGE');
    expect(typeTags[1].textContent).toBe('VIDEO');

    // Download button initial count
    const dlBtn = document.querySelector<HTMLButtonElement>('.soc-btn-download');
    expect(dlBtn?.textContent).toContain('Download Selected (2)');
    expect(dlBtn?.disabled).toBe(false);
  });

  it('handles Deselect All and Select All toggles', () => {
    const onDownload = vi.fn();
    openSelectionModal({ items: mockItems, onDownload });

    const deselectBtn = document.querySelector<HTMLButtonElement>('.soc-btn-deselect-all')!;
    const selectAllBtn = document.querySelector<HTMLButtonElement>('.soc-btn-select-all')!;
    const dlBtn = document.querySelector<HTMLButtonElement>('.soc-btn-download')!;
    const checkboxes = document.querySelectorAll<HTMLInputElement>('.soc-card-checkbox');

    // Deselect All
    deselectBtn.click();
    expect(checkboxes[0].checked).toBe(false);
    expect(checkboxes[1].checked).toBe(false);
    expect(dlBtn.textContent).toContain('Download Selected (0)');
    expect(dlBtn.disabled).toBe(true);

    // Select All
    selectAllBtn.click();
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(true);
    expect(dlBtn.textContent).toContain('Download Selected (2)');
    expect(dlBtn.disabled).toBe(false);
  });

  it('downloads selected subset when user unchecks an item and clicks download', () => {
    const onDownload = vi.fn();
    openSelectionModal({ items: mockItems, onDownload });

    const checkboxes = document.querySelectorAll<HTMLInputElement>('.soc-card-checkbox');
    // Uncheck second item
    checkboxes[1].click();

    const dlBtn = document.querySelector<HTMLButtonElement>('.soc-btn-download')!;
    expect(dlBtn.textContent).toContain('Download Selected (1)');

    dlBtn.click();
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledWith([mockItems[0]]);

    // Modal removed
    expect(document.querySelector('.soc-modal-backdrop')).toBeNull();
  });

  it('closes modal on close button click and on Escape key', () => {
    const onClose = vi.fn();
    openSelectionModal({ items: mockItems, onDownload: vi.fn(), onClose });

    expect(document.querySelector('.soc-modal-backdrop')).not.toBeNull();
    const closeBtn = document.querySelector<HTMLButtonElement>('.soc-modal-close')!;
    closeBtn.click();
    expect(document.querySelector('.soc-modal-backdrop')).toBeNull();
    expect(onClose).toHaveBeenCalled();

    // Reopen and test Escape
    openSelectionModal({ items: mockItems, onDownload: vi.fn() });
    expect(document.querySelector('.soc-modal-backdrop')).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.soc-modal-backdrop')).toBeNull();
  });
});
