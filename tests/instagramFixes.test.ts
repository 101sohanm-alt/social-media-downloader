import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setupInstagramInjector,
  INSTAGRAM_SHORTCODE_REGEX,
} from '../src/content/platforms/instagram';
import {
  matchesShortcode,
  isTargetUrl,
  stripForLoopPrefix
} from '../src/content/main_interceptor';
import { ExtractedMediaItem } from '../src/shared/types';

describe('Instagram Media Downloading Fixes (TDD Red Phase)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    window.history.pushState({}, '', '/');
  });

  // 1. Late share button hydration (>3 mutation ticks)
  it('injects download button on posts with late share button hydration (>3 mutation ticks)', async () => {
    const mediaCache = new Map<string, ExtractedMediaItem[]>();
    const requestDownloadMock = vi.fn().mockResolvedValue(true);

    const article = document.createElement('article');
    const link = document.createElement('a');
    link.href = 'https://www.instagram.com/p/LATE_HYDRATION_123/';
    article.appendChild(link);
    document.body.appendChild(article);

    setupInstagramInjector(mediaCache, requestDownloadMock);

    // Simulate 4 mutation ticks before share button appears
    for (let i = 0; i < 4; i++) {
      const dummy = document.createElement('div');
      article.appendChild(dummy);
      await new Promise((r) => setTimeout(r, 120));
    }

    // Now the share button finally hydrates into the DOM
    const shareBtn = document.createElement('button');
    shareBtn.setAttribute('aria-label', 'Share Post');
    article.appendChild(shareBtn);

    // Wait for mutation observer and debounce to trigger
    await new Promise((r) => setTimeout(r, 150));

    const dlBtn = article.querySelector('.soc-dl-btn');
    expect(dlBtn).not.toBeNull();
  });

  // 2. Stripping for (;;); prefix from Instagram API payloads
  it('strips for (;;); prefix from Instagram API payloads', () => {
    const rawPayload = 'for (;;);{"data":{"xdt_shortcode_media":{"code":"TEST_STRIP","is_video":true}}}';
    const stripped = stripForLoopPrefix(rawPayload);
    expect(stripped).toBe('{"data":{"xdt_shortcode_media":{"code":"TEST_STRIP","is_video":true}}}');
    expect(() => JSON.parse(stripped)).not.toThrow();
    expect(JSON.parse(stripped).data.xdt_shortcode_media.code).toBe('TEST_STRIP');

    // Also handles whitespace variations around for(;;)
    const spacedPayload = '  for ( ; ; ) ;  {"status": "ok"}';
    expect(stripForLoopPrefix(spacedPayload)).toBe('{"status": "ok"}');
  });

  // 3. Shortcode extraction regex and logic supports /reels/<id>/ plural
  it('extracts shortcode from plural /reels/<id>/ URLs and container links', async () => {
    const shortcode = 'C_xyzPlural99';
    const url1 = `https://www.instagram.com/reels/${shortcode}/`;
    const url2 = `/reels/${shortcode}/?utm_source=ig_web_copy_link`;

    expect(INSTAGRAM_SHORTCODE_REGEX).toBeDefined();
    const match1 = url1.match(INSTAGRAM_SHORTCODE_REGEX);
    const match2 = url2.match(INSTAGRAM_SHORTCODE_REGEX);

    expect(match1).not.toBeNull();
    expect(match1?.[2]).toBe(shortcode);
    expect(match2).not.toBeNull();
    expect(match2?.[2]).toBe(shortcode);

    // Test that injector identifies /reels/ shortcode on post container and can download
    const container = document.createElement('article');
    const link = document.createElement('a');
    link.href = `https://www.instagram.com/reels/${shortcode}/`;
    container.appendChild(link);
    const shareBtn = document.createElement('button');
    shareBtn.setAttribute('aria-label', 'Share Post');
    container.appendChild(shareBtn);
    document.body.appendChild(container);

    const mediaCache = new Map<string, ExtractedMediaItem[]>();
    const requestDownloadMock = vi.fn().mockResolvedValue(true);
    setupInstagramInjector(mediaCache, requestDownloadMock);

    const dlBtn = container.querySelector('.soc-dl-btn') as HTMLButtonElement;
    expect(dlBtn).not.toBeNull();

    mediaCache.set(shortcode, [{
      id: shortcode,
      platform: 'instagram',
      type: 'video',
      author: 'creator',
      url: 'https://cdninstagram.com/reel.mp4',
      ext: '.mp4'
    }]);

    dlBtn.click();
    await new Promise((r) => setTimeout(r, 50));

    expect(requestDownloadMock).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: shortcode })]),
      expect.any(Object)
    );
  });

  // 4. Dedicated Reels containers (main[role="main"] section, div[role="presentation"]) outside <article>
  it('injects download button into dedicated Reels containers outside article', async () => {
    // Container 1: main[role="main"] section
    const main = document.createElement('main');
    main.setAttribute('role', 'main');
    const section = document.createElement('section');
    const link1 = document.createElement('a');
    link1.href = 'https://www.instagram.com/reel/REEL_SECTION_1/';
    section.appendChild(link1);
    const shareBtn1 = document.createElement('button');
    shareBtn1.setAttribute('aria-label', 'Share Post');
    section.appendChild(shareBtn1);
    main.appendChild(section);
    document.body.appendChild(main);

    // Container 2: div[role="presentation"]
    const presentationDiv = document.createElement('div');
    presentationDiv.setAttribute('role', 'presentation');
    const link2 = document.createElement('a');
    link2.href = 'https://www.instagram.com/reel/REEL_PRES_2/';
    presentationDiv.appendChild(link2);
    const shareBtn2 = document.createElement('button');
    shareBtn2.setAttribute('aria-label', 'Share Post');
    presentationDiv.appendChild(shareBtn2);
    document.body.appendChild(presentationDiv);

    const mediaCache = new Map<string, ExtractedMediaItem[]>();
    const requestDownloadMock = vi.fn().mockResolvedValue(true);
    setupInstagramInjector(mediaCache, requestDownloadMock);

    expect(section.querySelector('.soc-dl-btn')).not.toBeNull();
    expect(presentationDiv.querySelector('.soc-dl-btn')).not.toBeNull();
  });

  // 5. matchesShortcode matches <video> elements on /reels/<id>/ pages without failing
  it('matchesShortcode matches <video> elements on /reels/<id>/ pages and in section containers', () => {
    const shortcode = 'REEL_SHORT_123';
    window.history.pushState({}, '', `/reels/${shortcode}/`);

    const section = document.createElement('section');
    const video = document.createElement('video');
    section.appendChild(video);
    document.body.appendChild(section);

    const matched = matchesShortcode(video, shortcode);
    expect(matched).toBe(true);
  });

  // 6. isTargetUrl matching with query params
  it('isTargetUrl matches /graphql/query and /api/v1/ even with query parameters', () => {
    expect(isTargetUrl('https://www.instagram.com/graphql/query/?query_hash=abc123xyz')).toBe(true);
    expect(isTargetUrl('/graphql/query/?doc_id=8845758582119845&variables=%7B%7D')).toBe(true);
    expect(isTargetUrl('/api/v1/feed/user/123/?count=12')).toBe(true);
    expect(isTargetUrl('https://i.instagram.com/api/v1/media/312345/info/')).toBe(true);
  });
});
