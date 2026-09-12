import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupInstagramInjector } from '../src/content/platforms/instagram';
import { ExtractedMediaItem } from '../src/shared/types';

describe('Instagram Video Controls Removal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('does NOT inject video controls or set dataset.socControlsInjected on <video> elements on initial pass, but STILL injects download button', () => {
    // Setup post container with video and share button
    const post = document.createElement('article');
    const link = document.createElement('a');
    link.href = 'https://www.instagram.com/p/TEST_POST_1/';
    post.appendChild(link);

    const video = document.createElement('video');
    video.src = 'https://instagram.com/video.mp4';
    post.appendChild(video);

    const shareBtn = document.createElement('button');
    shareBtn.setAttribute('aria-label', 'Share Post');
    post.appendChild(shareBtn);

    document.body.appendChild(post);

    const mediaCache = new Map<string, ExtractedMediaItem[]>();
    const requestDownloadMock = vi.fn().mockResolvedValue(true);

    setupInstagramInjector(mediaCache, requestDownloadMock);

    // Verify video controls are NOT injected
    expect(video.dataset.socControlsInjected).toBeUndefined();
    expect(document.querySelector('.soc-video-controls-overlay, .soc-video-controls')).toBeNull();

    // Verify download button IS injected
    const dlBtn = post.querySelector('.soc-dl-btn');
    expect(dlBtn).not.toBeNull();
  });

  it('does NOT inject video controls when video elements are dynamically added via MutationObserver', async () => {
    const post = document.createElement('article');
    const link = document.createElement('a');
    link.href = 'https://www.instagram.com/reel/TEST_REEL_1/';
    post.appendChild(link);

    const shareBtn = document.createElement('button');
    shareBtn.setAttribute('aria-label', 'Share Post');
    post.appendChild(shareBtn);

    document.body.appendChild(post);

    const mediaCache = new Map<string, ExtractedMediaItem[]>();
    const requestDownloadMock = vi.fn().mockResolvedValue(true);

    setupInstagramInjector(mediaCache, requestDownloadMock);

    // Dynamically insert a video element into the post
    const video = document.createElement('video');
    video.src = 'https://instagram.com/dyn-video.mp4';
    post.appendChild(video);

    // Wait a tick for MutationObserver
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify controls were not added to dynamically inserted video
    expect(video.dataset.socControlsInjected).toBeUndefined();
    expect(document.querySelector('.soc-video-controls-overlay, .soc-video-controls')).toBeNull();
    expect(post.querySelector('.soc-dl-btn')).not.toBeNull();
  });
});
