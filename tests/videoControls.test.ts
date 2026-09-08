import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTime, attachVideoControls, getVideoDuration } from '../src/content/ui/videoControls';
import { MediaQuality } from '../src/shared/types';

describe('Video Controls - Utility formatTime and getVideoDuration', () => {
  it('formats seconds into M:SS correctly', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(45)).toBe('0:45');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(600)).toBe('10:00');
  });

  it('formats hours into H:MM:SS when duration exceeds an hour', () => {
    expect(formatTime(3600)).toBe('1:00:00');
    expect(formatTime(3665)).toBe('1:01:05');
  });

  it('handles negative or NaN gracefully', () => {
    expect(formatTime(-5)).toBe('0:00');
    expect(formatTime(NaN)).toBe('0:00');
  });

  it('extracts duration correctly from seekable when duration is Infinity', () => {
    const vid = document.createElement('video');
    Object.defineProperty(vid, 'duration', { value: Infinity, configurable: true });
    Object.defineProperty(vid, 'seekable', {
      value: {
        length: 1,
        end: (idx: number) => 42.5
      },
      configurable: true
    });

    expect(getVideoDuration(vid)).toBe(42.5);
  });
});

describe('Video Controls Component (UI & Interactions)', () => {
  let video: HTMLVideoElement;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    container.style.position = 'relative';
    container.style.width = '600px';
    container.style.height = '400px';

    video = document.createElement('video');
    video.src = 'https://example.com/video_720.mp4';
    Object.defineProperty(video, 'duration', { value: 60, writable: true, configurable: true });
    Object.defineProperty(video, 'currentTime', { value: 20, writable: true, configurable: true });
    video.play = vi.fn().mockImplementation(() => {
      Object.defineProperty(video, 'paused', { value: false, writable: true, configurable: true });
      video.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    video.pause = vi.fn().mockImplementation(() => {
      Object.defineProperty(video, 'paused', { value: true, writable: true, configurable: true });
      video.dispatchEvent(new Event('pause'));
    });

    container.appendChild(video);
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('attaches overlay controls with play/pause, time, volume, and timeline', () => {
    const controls = attachVideoControls(video, container);
    expect(controls).not.toBeNull();
    expect(container.querySelector('.soc-video-controls')).not.toBeNull();

    // Play/Pause button exists
    const playBtn = container.querySelector('.soc-ctrl-play') as HTMLButtonElement;
    expect(playBtn).not.toBeNull();

    // Time display exists
    const timeDisplay = container.querySelector('.soc-ctrl-time') as HTMLElement;
    expect(timeDisplay).not.toBeNull();

    // Timeline bar exists
    const timeline = container.querySelector('.soc-timeline-bar') as HTMLElement;
    expect(timeline).not.toBeNull();
  });

  it('toggles play and pause on button click', () => {
    attachVideoControls(video, container);
    const playBtn = container.querySelector('.soc-ctrl-play') as HTMLButtonElement;

    // Initially paused -> click to play
    playBtn.click();
    expect(video.play).toHaveBeenCalled();

    // Now playing -> click to pause
    playBtn.click();
    expect(video.pause).toHaveBeenCalled();
  });

  it('omits 10s jump buttons and picture-in-picture button for a clean subtle single line, while providing volume controls', () => {
    attachVideoControls(video, container);
    expect(container.querySelector('.soc-ctrl-jump-back')).toBeNull();
    expect(container.querySelector('.soc-ctrl-jump-fwd')).toBeNull();
    expect(container.querySelector('.soc-pip-btn')).toBeNull();
    expect(container.querySelector('.soc-volume-group')).not.toBeNull();
    expect(container.querySelector('.soc-ctrl-volume-btn')).not.toBeNull();
    expect(container.querySelector('.soc-ctrl-volume-slider')).not.toBeNull();
  });

  it('renders all controls in a single horizontal row including volume controls', () => {
    attachVideoControls(video, container);
    const controls = container.querySelector('.soc-video-controls') as HTMLElement;
    expect(controls).not.toBeNull();

    // Verify direct children exist in the single-line container
    const playBtn = controls.querySelector('.soc-ctrl-play');
    const timeDisplay = controls.querySelector('.soc-ctrl-time');
    const timeline = controls.querySelector('.soc-timeline-container');
    const volumeGroup = controls.querySelector('.soc-volume-group');
    const speedBtn = controls.querySelector('.soc-ctrl-speed');
    const fullscreenBtn = controls.querySelector('.soc-fullscreen-btn');

    expect(playBtn).not.toBeNull();
    expect(timeDisplay).not.toBeNull();
    expect(timeline).not.toBeNull();
    expect(volumeGroup).not.toBeNull();
    expect(speedBtn).not.toBeNull();
    expect(fullscreenBtn).not.toBeNull();

    // Ensure no multi-row wrappers exist
    expect(controls.querySelector('.soc-controls-row')).toBeNull();
  });

  it('controls volume: toggles mute, updates slider, and syncs on volumechange', () => {
    video.volume = 1;
    video.muted = false;

    attachVideoControls(video, container);
    const volumeGroup = container.querySelector('.soc-volume-group') as HTMLElement;
    const volumeBtn = container.querySelector('.soc-ctrl-volume-btn') as HTMLButtonElement;
    const volumeSlider = container.querySelector('.soc-ctrl-volume-slider') as HTMLInputElement;

    expect(volumeGroup).not.toBeNull();
    expect(volumeBtn).not.toBeNull();
    expect(volumeSlider).not.toBeNull();
    expect(parseFloat(volumeSlider.value)).toBe(1);

    // 1. Toggle mute on button click
    volumeBtn.click();
    expect(video.muted).toBe(true);

    // 2. Unmute on button click
    volumeBtn.click();
    expect(video.muted).toBe(false);

    // If volume was 0 when unmuting, volume should restore to 1
    video.volume = 0;
    video.muted = true;
    volumeBtn.click();
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(1);

    // 3. Adjust volume slider
    volumeSlider.value = '0.5';
    volumeSlider.dispatchEvent(new Event('input'));
    expect(video.volume).toBeCloseTo(0.5);
    expect(video.muted).toBe(false);

    // Slider to 0 should mute
    volumeSlider.value = '0';
    volumeSlider.dispatchEvent(new Event('input'));
    expect(video.volume).toBe(0);
    expect(video.muted).toBe(true);

    // 4. Two-way sync when video fires volumechange
    video.volume = 0.75;
    video.muted = false;
    video.dispatchEvent(new Event('volumechange'));
    expect(parseFloat(volumeSlider.value)).toBeCloseTo(0.75);

    video.muted = true;
    video.dispatchEvent(new Event('volumechange'));
    expect(volumeBtn.innerHTML).toContain('line'); // VOLUME_MUTED_SVG contains <line>
  });

  it('seeks video when clicking or scrubbing along the timeline track', () => {
    attachVideoControls(video, container);
    const timelineContainer = container.querySelector('.soc-timeline-container') as HTMLElement;
    const timelineTrack = container.querySelector('.soc-timeline-track') as HTMLElement;
    expect(timelineContainer).not.toBeNull();
    expect(timelineTrack).not.toBeNull();

    // Mock bounding client rect for track
    vi.spyOn(timelineTrack, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 0,
      width: 200,
      height: 4,
      right: 300,
      bottom: 4,
      x: 100,
      y: 0,
      toJSON: () => {}
    });

    // Duration is 60s. Click at clientX = 200 (halfway: (200 - 100) / 200 = 0.5) -> should seek to 30s
    const pointerDown = new Event('pointerdown', { bubbles: true, cancelable: true }) as any;
    pointerDown.clientX = 200;
    pointerDown.pointerId = 1;
    if (timelineContainer.setPointerCapture) {
      timelineContainer.setPointerCapture = vi.fn();
    }
    timelineContainer.dispatchEvent(pointerDown);

    expect(video.currentTime).toBe(30);

    // Scrub to clientX = 250 (75%: (250 - 100) / 200 = 0.75) -> should seek to 45s
    const pointerMove = new Event('pointermove', { bubbles: true, cancelable: true }) as any;
    pointerMove.clientX = 250;
    pointerMove.pointerId = 1;
    timelineContainer.dispatchEvent(pointerMove);

    expect(video.currentTime).toBe(45);

    // Global window pointermove outside the container (e.g. clientX = 150 -> 25% -> 15s)
    const globalMove = new Event('pointermove', { bubbles: true, cancelable: true }) as any;
    globalMove.clientX = 150;
    window.dispatchEvent(globalMove);

    expect(video.currentTime).toBe(15);

    // Global window pointerup ends scrubbing
    const globalUp = new Event('pointerup', { bubbles: true, cancelable: true }) as any;
    window.dispatchEvent(globalUp);
    expect(timelineContainer.classList.contains('soc-scrubbing')).toBe(false);
  });

  it('switches quality source when quality selector changes', () => {
    const mockQualities: MediaQuality[] = [
      { label: '1080p', url: 'https://example.com/video_1080.mp4', width: 1080, height: 1920 },
      { label: '720p', url: 'https://example.com/video_720.mp4', width: 720, height: 1280 },
    ];

    attachVideoControls(video, container, { qualities: mockQualities });
    const qualitySelect = container.querySelector('.soc-ctrl-quality') as HTMLSelectElement;
    expect(qualitySelect).not.toBeNull();
    expect(qualitySelect.options).toHaveLength(2);

    video.currentTime = 25;
    qualitySelect.value = mockQualities[0].url;
    qualitySelect.dispatchEvent(new Event('change'));

    expect(video.src).toBe(mockQualities[0].url);
  });

  it('autohides controls after 2.5s when playing, reappears on mousemove', () => {
    vi.useFakeTimers();
    attachVideoControls(video, container);
    const overlay = container.querySelector('.soc-video-controls') as HTMLElement;

    // Trigger playing
    Object.defineProperty(video, 'paused', { value: false });
    video.dispatchEvent(new Event('play'));

    // Move mouse in container to reset timer
    container.dispatchEvent(new MouseEvent('mousemove'));
    expect(overlay.classList.contains('soc-hidden')).toBe(false);

    // Advance 2.5 seconds
    vi.advanceTimersByTime(2600);
    expect(overlay.classList.contains('soc-hidden')).toBe(true);

    // Document-level mouse move over video area brings it back
    vi.spyOn(video, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 100,
      right: 500,
      bottom: 400,
      width: 400,
      height: 300,
      x: 100,
      y: 100,
      toJSON: () => {}
    });

    const docMove = new MouseEvent('mousemove', { bubbles: true, cancelable: true });
    Object.defineProperty(docMove, 'clientX', { value: 200 });
    Object.defineProperty(docMove, 'clientY', { value: 200 });
    document.dispatchEvent(docMove);

    expect(overlay.classList.contains('soc-hidden')).toBe(false);
  });

  it('stops event propagation to prevent triggering Instagram like / navigation', () => {
    attachVideoControls(video, container);
    const overlay = container.querySelector('.soc-video-controls') as HTMLElement;

    const clickSpy = vi.fn();
    container.addEventListener('click', clickSpy);

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    const stopSpy = vi.spyOn(event, 'stopPropagation');
    const stopImmSpy = vi.spyOn(event, 'stopImmediatePropagation');

    overlay.dispatchEvent(event);

    expect(stopSpy).toHaveBeenCalled();
    expect(stopImmSpy).toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
