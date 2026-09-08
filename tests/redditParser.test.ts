import { describe, it, expect } from 'vitest';
import { parseRedditMedia } from '../src/parsers/redditParser';

describe('Reddit Media Parser', () => {
  it('extracts direct image URL for i.redd.it post', () => {
    const mockPost = {
      kind: 't3',
      data: {
        id: 'abc123z',
        author: 'redditor42',
        title: 'A stunning sunset in 4K',
        url_overridden_by_dest: 'https://i.redd.it/sunset_4k.jpg',
        post_hint: 'image',
        created_utc: 1690000000,
      },
    };

    const result = parseRedditMedia(mockPost);
    expect(result).toHaveLength(1);
    expect(result[0].platform).toBe('reddit');
    expect(result[0].type).toBe('image');
    expect(result[0].url).toBe('https://i.redd.it/sunset_4k.jpg');
    expect(result[0].author).toBe('redditor42');
    expect(result[0].title).toBe('A stunning sunset in 4K');
    expect(result[0].id).toBe('abc123z');
  });

  it('extracts gallery items in correct order and unescapes XML entities', () => {
    const mockGallery = {
      kind: 't3',
      data: {
        id: 'gal789',
        author: 'gallery_curator',
        title: 'My road trip photos',
        is_gallery: true,
        gallery_data: {
          items: [
            { media_id: 'img1', id: 101 },
            { media_id: 'img2', id: 102 },
          ],
        },
        media_metadata: {
          img1: {
            status: 'valid',
            e: 'Image',
            m: 'image/jpg',
            s: {
              u: 'https://preview.redd.it/img1.jpg?width=1080&amp;format=pjpg&amp;auto=webp&amp;s=abc',
              x: 1080,
              y: 720,
            },
          },
          img2: {
            status: 'valid',
            e: 'Image',
            m: 'image/png',
            s: {
              u: 'https://preview.redd.it/img2.png?width=1920&amp;format=png&amp;auto=webp&amp;s=def',
              x: 1920,
              y: 1080,
            },
          },
        },
      },
    };

    const result = parseRedditMedia(mockGallery);
    expect(result).toHaveLength(2);
    expect(result[0].index).toBe(1);
    expect(result[0].total).toBe(2);
    expect(result[0].url).toBe('https://preview.redd.it/img1.jpg?width=1080&format=pjpg&auto=webp&s=abc');
    expect(result[0].width).toBe(1080);
    expect(result[0].height).toBe(720);

    expect(result[1].index).toBe(2);
    expect(result[1].total).toBe(2);
    expect(result[1].url).toBe('https://preview.redd.it/img2.png?width=1920&format=png&auto=webp&s=def');
  });

  it('detects separated DASH video and audio streams and returns muxing targets', () => {
    const mockVideo = {
      kind: 't3',
      data: {
        id: 'vid999',
        author: 'videomaker',
        title: 'Cats playing piano',
        is_video: true,
        media: {
          reddit_video: {
            fallback_url: 'https://v.redd.it/7d8s9a0/DASH_1080.mp4?source=fallback',
            height: 1080,
            width: 1920,
            duration: 45,
            has_audio: true,
          },
        },
      },
    };

    const result = parseRedditMedia(mockVideo);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('video');
    expect(result[0].url).toBe('https://v.redd.it/7d8s9a0/DASH_1080.mp4?source=fallback');
    expect(result[0].width).toBe(1920);
    expect(result[0].height).toBe(1080);
    // Audio stream is constructed for DASH muxing
    expect(result[0].audioUrl).toBeDefined();
    expect(result[0].audioUrl).toContain('https://v.redd.it/7d8s9a0/DASH_');
  });

  it('extracts media from direct array responses (/r/.../comments.json)', () => {
    const mockCommentsListing = [
      {
        kind: 'Listing',
        data: {
          children: [
            {
              kind: 't3',
              data: {
                id: 'listing_item',
                author: 'author1',
                title: 'Listing post',
                url: 'https://i.redd.it/sample.png',
              },
            },
          ],
        },
      },
    ];

    const result = parseRedditMedia(mockCommentsListing);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('listing_item');
    expect(result[0].url).toBe('https://i.redd.it/sample.png');
  });
});
