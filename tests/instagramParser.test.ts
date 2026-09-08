import { describe, it, expect } from 'vitest';
import { parseInstagramMedia } from '../src/parsers/instagramParser';

describe('Instagram Media Parser', () => {
  it('extracts highest resolution candidate from single photo post', () => {
    const mockPost = {
      id: '31234567890123_456',
      code: 'CxYz123AbC',
      user: { username: 'traveler' },
      caption: { text: 'Sunny beach in Bali' },
      image_versions2: {
        candidates: [
          { width: 1080, height: 1350, url: 'https://instagram.fna.fbcdn.net/v/1080.jpg?stp=dst-jpg' },
          { width: 750, height: 937, url: 'https://instagram.fna.fbcdn.net/v/750.jpg?stp=dst-jpg' },
          { width: 320, height: 400, url: 'https://instagram.fna.fbcdn.net/v/320.jpg?stp=dst-jpg' },
        ],
      },
    };

    const result = parseInstagramMedia(mockPost);
    expect(result).toHaveLength(1);
    expect(result[0].platform).toBe('instagram');
    expect(result[0].type).toBe('image');
    expect(result[0].id).toBe('CxYz123AbC');
    expect(result[0].author).toBe('traveler');
    expect(result[0].width).toBe(1080);
    expect(result[0].height).toBe(1350);
    expect(result[0].url).toBe('https://instagram.fna.fbcdn.net/v/1080.jpg?stp=dst-jpg');
  });

  it('extracts full list of media items from carousel post', () => {
    const mockCarousel = {
      id: '9988776655_11',
      code: 'CarouselCode99',
      user: { username: 'photographer' },
      carousel_media_count: 3,
      carousel_media: [
        {
          id: 'c1',
          image_versions2: {
            candidates: [
              { width: 1080, height: 1080, url: 'https://instagram.fna.fbcdn.net/c1_1080.jpg' },
              { width: 640, height: 640, url: 'https://instagram.fna.fbcdn.net/c1_640.jpg' },
            ],
          },
        },
        {
          id: 'c2',
          video_versions: [
            { width: 720, height: 720, url: 'https://instagram.fna.fbcdn.net/c2_720.mp4' },
          ],
        },
        {
          id: 'c3',
          image_versions2: {
            candidates: [
              { width: 1440, height: 1440, url: 'https://instagram.fna.fbcdn.net/c3_1440.jpg' },
            ],
          },
        },
      ],
    };

    const result = parseInstagramMedia(mockCarousel);
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('image');
    expect(result[0].index).toBe(1);
    expect(result[0].total).toBe(3);
    expect(result[0].url).toBe('https://instagram.fna.fbcdn.net/c1_1080.jpg');

    expect(result[1].type).toBe('video');
    expect(result[1].index).toBe(2);
    expect(result[1].total).toBe(3);
    expect(result[1].url).toBe('https://instagram.fna.fbcdn.net/c2_720.mp4');

    expect(result[2].type).toBe('image');
    expect(result[2].index).toBe(3);
    expect(result[2].width).toBe(1440);
  });

  it('extracts direct video URL for Reel', () => {
    const mockReel = {
      id: '5544332211_00',
      code: 'ReelShortcode',
      user: { username: 'comedian' },
      media_type: 2,
      video_versions: [
        { width: 1080, height: 1920, url: 'https://instagram.fna.fbcdn.net/reel_1080.mp4' },
        { width: 720, height: 1280, url: 'https://instagram.fna.fbcdn.net/reel_720.mp4' },
      ],
    };

    const result = parseInstagramMedia(mockReel);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('video');
    expect(result[0].id).toBe('ReelShortcode');
    expect(result[0].author).toBe('comedian');
    expect(result[0].url).toBe('https://instagram.fna.fbcdn.net/reel_1080.mp4');
    expect(result[0].width).toBe(1080);
    expect(result[0].height).toBe(1920);
  });

  it('handles GraphQL shortcode_media format', () => {
    const mockGraphQL = {
      data: {
        shortcode_media: {
          shortcode: 'GqlShortcode',
          owner: { username: 'gqluser' },
          is_video: false,
          display_url: 'https://instagram.fna.fbcdn.net/fallback.jpg',
          display_resources: [
            { src: 'https://instagram.fna.fbcdn.net/res_640.jpg', config_width: 640, config_height: 640 },
            { src: 'https://instagram.fna.fbcdn.net/res_1080.jpg', config_width: 1080, config_height: 1080 },
          ],
        },
      },
    };

    const result = parseInstagramMedia(mockGraphQL);
    expect(result).toHaveLength(1);
    expect(result[0].author).toBe('gqluser');
    expect(result[0].url).toBe('https://instagram.fna.fbcdn.net/res_1080.jpg');
  });

  it('handles items array format from /p/{shortcode}/?__a=1&__d=dis', () => {
    const mockDisResponse = {
      items: [
        {
          id: '123456789_0',
          code: 'BatchCarouselCode',
          user: { username: 'multiuser' },
          carousel_media_count: 2,
          carousel_media: [
            {
              id: 'm1',
              image_versions2: {
                candidates: [{ width: 1080, height: 1080, url: 'https://instagram.fna.fbcdn.net/m1.jpg' }],
              },
            },
            {
              id: 'm2',
              image_versions2: {
                candidates: [{ width: 1080, height: 1080, url: 'https://instagram.fna.fbcdn.net/m2.jpg' }],
              },
            },
          ],
        },
      ],
    };

    const result = parseInstagramMedia(mockDisResponse);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('BatchCarouselCode');
    expect(result[0].author).toBe('multiuser');
    expect(result[0].url).toBe('https://instagram.fna.fbcdn.net/m1.jpg');
    expect(result[1].url).toBe('https://instagram.fna.fbcdn.net/m2.jpg');
  });

  it('handles xdt_shortcode_media format', () => {
    const mockXdt = {
      data: {
        xdt_shortcode_media: {
          shortcode: 'XdtCode',
          owner: { username: 'xdtuser' },
          is_video: false,
          display_url: 'https://instagram.fna.fbcdn.net/xdt.jpg',
        },
      },
    };

    const result = parseInstagramMedia(mockXdt);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('XdtCode');
    expect(result[0].author).toBe('xdtuser');
  });

  it('handles modern xdt_api__v1__media__shortcode__web_info carousel with >3 items (e.g. 5 slides)', () => {
    const mockWebInfo = {
      data: {
        xdt_api__v1__media__shortcode__web_info: {
          items: [
            {
              id: '33445566_0',
              code: 'ModernCarousel5',
              user: { username: 'artist' },
              carousel_media_count: 5,
              carousel_media: Array.from({ length: 5 }, (_, i) => ({
                id: `slide_${i + 1}`,
                image_versions2: {
                  candidates: [
                    { width: 1080, height: 1080, url: `https://instagram.fna.fbcdn.net/slide_${i + 1}_1080.jpg` },
                    { width: 640, height: 640, url: `https://instagram.fna.fbcdn.net/slide_${i + 1}_640.jpg` }
                  ]
                }
              }))
            }
          ]
        }
      }
    };

    const result = parseInstagramMedia(mockWebInfo);
    expect(result).toHaveLength(5);
    expect(result[0].id).toBe('ModernCarousel5');
    expect(result[0].author).toBe('artist');
    expect(result[0].index).toBe(1);
    expect(result[0].total).toBe(5);
    expect(result[0].url).toBe('https://instagram.fna.fbcdn.net/slide_1_1080.jpg');
    expect(result[4].index).toBe(5);
    expect(result[4].url).toBe('https://instagram.fna.fbcdn.net/slide_5_1080.jpg');
  });
});

