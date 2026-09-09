import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtractedMediaItem } from '../src/shared/types';
import { setupInstagramInjector, collectCarouselSlidesBySwiping } from '../src/content/platforms/instagram';
import { closePickerModal } from '../src/content/ui/pickerModal';

const SLIDES = [1, 2, 3, 4].map((n) => `https://scontent.cdninstagram.com/s${n}.jpg`);

/**
 * Builds a mock 4-photo carousel: one rendered <img> plus working
 * Next/Previous buttons that cycle through SLIDES.
 */
function buildMockCarousel(shortcode: string): { container: HTMLElement; img: HTMLImageElement } {
  const container = document.createElement('article');

  const link = document.createElement('a');
  link.href = `https://www.instagram.com/p/${shortcode}/`;
  container.appendChild(link);

  const shareBtn = document.createElement('button');
  shareBtn.setAttribute('aria-label', 'Share Post');
  container.appendChild(shareBtn);

  // Carousel clue (dots) so the injector treats this as a carousel.
  const tablist = document.createElement('div');
  tablist.setAttribute('role', 'tablist');
  container.appendChild(tablist);

  const img = document.createElement('img');
  img.src = SLIDES[0];
  container.appendChild(img);

  let pos = 0;
  const prev = document.createElement('button');
  prev.setAttribute('aria-label', 'Previous');
  const next = document.createElement('button');
  next.setAttribute('aria-label', 'Next');

  function paint() {
    img.src = SLIDES[pos];
    (next as HTMLButtonElement).disabled = pos >= SLIDES.length - 1;
    (prev as HTMLButtonElement).disabled = pos <= 0;
  }
  next.addEventListener('click', () => {
    if (pos < SLIDES.length - 1) pos++;
    paint();
  });
  prev.addEventListener('click', () => {
    if (pos > 0) pos--;
    paint();
  });
  paint();

  container.appendChild(prev);
  container.appendChild(next);
  document.body.appendChild(container);
  return { container, img };
}

function cachedItems(shortcode: string, n: number): ExtractedMediaItem[] {
  return SLIDES.slice(0, n).map((url, i) => ({
    id: shortcode,
    platform: 'instagram' as const,
    type: 'image' as const,
    author: 'creator',
    url,
    ext: '.jpg',
    index: i + 1,
    total: n,
    thumbnailUrl: url
  }));
}

describe('Instagram carousel swipe recovery', () => {
  beforeEach(() => {
    closePickerModal();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('collectCarouselSlidesBySwiping recovers all 4 slides from a cache of 2 and restores position', async () => {
    const { container, img } = buildMockCarousel('SWIPE_UNIT');
    const existing = cachedItems('SWIPE_UNIT', 2);

    const merged = await collectCarouselSlidesBySwiping(container, 'SWIPE_UNIT', existing, {
      delayMs: 5
    });

    expect(merged.map((m) => m.url)).toEqual(SLIDES);
    // Slide position restored to the start
    expect(img.src).toBe(SLIDES[0]);
  });

  it('download click opens the picker with all 4 slides, not just the cached 2', async () => {
    buildMockCarousel('SWIPE_E2E');
    const mediaCache = new Map<string, ExtractedMediaItem[]>();
    mediaCache.set('SWIPE_E2E', cachedItems('SWIPE_E2E', 2));

    const requestDownloadMock = vi.fn().mockResolvedValue(true);
    setupInstagramInjector(mediaCache, requestDownloadMock);

    const dlBtn = document.querySelector('.soc-dl-btn') as HTMLButtonElement;
    expect(dlBtn).not.toBeNull();

    dlBtn.click();
    await vi.waitFor(
      () => {
        expect(document.querySelector('.soc-picker-backdrop')).not.toBeNull();
      },
      { timeout: 10000 }
    );

    // The bug: only 2 tiles. Fixed: one tile per slide.
    expect(document.querySelectorAll('.soc-picker-tile')).toHaveLength(4);
    expect(requestDownloadMock).not.toHaveBeenCalled();
  });
});
