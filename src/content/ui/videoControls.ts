import { MediaQuality } from '../../shared/types';

export interface VideoControlsOptions {
  qualities?: MediaQuality[];
  onQualityChange?: (quality: MediaQuality) => void;
}

export interface VideoControlsController {
  destroy: () => void;
  updateQualities: (qualities: MediaQuality[]) => void;
}

export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const paddedSecs = secs < 10 ? `0${secs}` : `${secs}`;

  if (hrs > 0) {
    const paddedMins = mins < 10 ? `0${mins}` : `${mins}`;
    return `${hrs}:${paddedMins}:${paddedSecs}`;
  }
  return `${mins}:${paddedSecs}`;
}

// SVG Icons
const PLAY_SVG = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3"></polygon>
  </svg>
`;

const PAUSE_SVG = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <rect x="6" y="4" width="4" height="16"></rect>
    <rect x="14" y="4" width="4" height="16"></rect>
  </svg>
`;

const VOLUME_HIGH_SVG = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"></polygon>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
  </svg>
`;

const VOLUME_MUTED_SVG = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"></polygon>
    <line x1="23" y1="9" x2="17" y2="15"></line>
    <line x1="17" y1="9" x2="23" y2="15"></line>
  </svg>
`;

const FULLSCREEN_SVG = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
  </svg>
`;

export function getVideoDuration(video: HTMLVideoElement): number {
  if (isFinite(video.duration) && video.duration > 0) {
    return video.duration;
  }
  if (video.seekable && video.seekable.length > 0) {
    try {
      const end = video.seekable.end(video.seekable.length - 1);
      if (isFinite(end) && end > 0) return end;
    } catch {
      // Ignore
    }
  }
  return 0;
}

export function attachVideoControls(
  video: HTMLVideoElement,
  targetContainer?: HTMLElement,
  options?: VideoControlsOptions
): VideoControlsController {
  const mountPoint = targetContainer || video.parentElement || video;

  // Event names to intercept from bubbling or defaulting to the host page
  const INTERCEPT_EVENTS = [
    'click',
    'dblclick',
    'mousedown',
    'mouseup',
    'pointerdown',
    'pointerup',
    'touchstart',
    'touchend'
  ] as const;

  // Build UI element
  const overlay = document.createElement('div');
  overlay.className = 'soc-video-controls';

  // Prevent event propagation and unwanted defaults to host page (e.g. anchor navigation)
  const onOverlayInterceptCapture = (e: Event) => {
    const target = e.target as HTMLElement | null;
    const isFormCtrl = target && (target.tagName === 'INPUT' || target.tagName === 'SELECT');
    if (!isFormCtrl) {
      e.preventDefault();
    }
    if (e.currentTarget === e.target) {
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  };

  const onOverlayInterceptBubble = (e: Event) => {
    const target = e.target as HTMLElement | null;
    const isFormCtrl = target && (target.tagName === 'INPUT' || target.tagName === 'SELECT');
    if (!isFormCtrl) {
      e.preventDefault();
    }
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  INTERCEPT_EVENTS.forEach((evt) => {
    overlay.addEventListener(evt, onOverlayInterceptCapture, { capture: true });
    overlay.addEventListener(evt, onOverlayInterceptBubble, { capture: false });
  });

  // Timeline Container
  const timelineContainer = document.createElement('div');
  timelineContainer.className = 'soc-timeline-container';

  const timelineTrack = document.createElement('div');
  timelineTrack.className = 'soc-timeline-track soc-timeline-bar';

  const bufferedBar = document.createElement('div');
  bufferedBar.className = 'soc-timeline-buffered';

  const progressBar = document.createElement('div');
  progressBar.className = 'soc-timeline-progress';

  const thumb = document.createElement('div');
  thumb.className = 'soc-timeline-thumb';

  const tooltip = document.createElement('div');
  tooltip.className = 'soc-timeline-tooltip';

  timelineTrack.appendChild(bufferedBar);
  timelineTrack.appendChild(progressBar);
  timelineTrack.appendChild(thumb);
  timelineContainer.appendChild(timelineTrack);
  timelineContainer.appendChild(tooltip);

  // Play/Pause Button
  const playPauseBtn = document.createElement('button');
  playPauseBtn.className = 'soc-ctrl-btn soc-ctrl-play soc-play-pause-btn';
  playPauseBtn.type = 'button';
  playPauseBtn.setAttribute('aria-label', 'Play/Pause');
  playPauseBtn.innerHTML = video.paused ? PLAY_SVG : PAUSE_SVG;

  // Time Display
  const timeDisplay = document.createElement('span');
  timeDisplay.className = 'soc-time-display soc-ctrl-time';
  timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(getVideoDuration(video))}`;

  // Audio preference tracking to guard against Instagram/React forced muting
  let userMutedPreference: boolean = video.muted;
  let userVolumePreference: number = (typeof video.volume === 'number' && video.volume > 0) ? video.volume : 1;

  // Volume Group (Mute Button & Slider)
  const volumeGroup = document.createElement('div');
  volumeGroup.className = 'soc-volume-group';

  const volumeBtn = document.createElement('button');
  volumeBtn.className = 'soc-ctrl-btn soc-ctrl-volume soc-ctrl-volume-btn';
  volumeBtn.type = 'button';
  const initialMuted = video.muted || video.volume === 0;
  volumeBtn.setAttribute('aria-label', initialMuted ? 'Unmute' : 'Mute');
  volumeBtn.innerHTML = initialMuted ? VOLUME_MUTED_SVG : VOLUME_HIGH_SVG;

  const volumeSlider = document.createElement('input');
  volumeSlider.className = 'soc-ctrl-volume-slider';
  volumeSlider.type = 'range';
  volumeSlider.min = '0';
  volumeSlider.max = '1';
  volumeSlider.step = '0.05';
  volumeSlider.value = String(video.muted ? 0 : (video.volume !== undefined ? video.volume : 1));
  volumeSlider.setAttribute('aria-label', 'Volume');

  volumeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (video.muted) {
      userMutedPreference = false;
      if (userVolumePreference === 0) {
        userVolumePreference = 1;
      }
      video.muted = false;
      if (video.volume === 0) {
        video.volume = userVolumePreference;
      }
    } else {
      userMutedPreference = true;
      video.muted = true;
    }
  });

  const onSliderInput = (e: Event) => {
    e.stopPropagation();
    const val = parseFloat(volumeSlider.value);
    video.volume = val;
    if (val === 0) {
      userMutedPreference = true;
      video.muted = true;
    } else {
      userMutedPreference = false;
      userVolumePreference = val;
      video.muted = false;
    }
  };
  volumeSlider.addEventListener('input', onSliderInput);
  volumeSlider.addEventListener('change', onSliderInput);

  const onVolumeChange = () => {
    if (!video.muted && video.volume > 0) {
      userMutedPreference = false;
      userVolumePreference = video.volume;
    } else if (video.muted && userMutedPreference === false) {
      // Reject host page / React forced mute and restore user preference
      video.muted = false;
      video.volume = userVolumePreference;
      return;
    }

    const isMuted = video.muted || video.volume === 0;
    volumeBtn.innerHTML = isMuted ? VOLUME_MUTED_SVG : VOLUME_HIGH_SVG;
    volumeBtn.setAttribute('aria-label', isMuted ? 'Unmute' : 'Mute');
    volumeSlider.value = String(video.muted ? 0 : (video.volume !== undefined ? video.volume : 1));
  };
  video.addEventListener('volumechange', onVolumeChange);

  const ensureUserAudioState = () => {
    if (userMutedPreference === false && video.muted) {
      video.muted = false;
      video.volume = userVolumePreference;
    }
  };
  video.addEventListener('seeking', ensureUserAudioState);
  video.addEventListener('seeked', ensureUserAudioState);
  video.addEventListener('play', ensureUserAudioState);

  volumeGroup.appendChild(volumeBtn);
  volumeGroup.appendChild(volumeSlider);

  // Speed Button (Cycling 1 -> 1.25 -> 1.5 -> 2 -> 0.5 -> 0.75 -> 1)
  const speedCycle = [1, 1.25, 1.5, 2, 0.5, 0.75];
  let currentSpeedIndex = 0;
  const speedBtn = document.createElement('button');
  speedBtn.className = 'soc-ctrl-btn soc-ctrl-speed';
  speedBtn.type = 'button';
  speedBtn.setAttribute('aria-label', 'Playback Speed');
  speedBtn.textContent = '1x';

  speedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    currentSpeedIndex = (currentSpeedIndex + 1) % speedCycle.length;
    const newSpeed = speedCycle[currentSpeedIndex];
    video.playbackRate = newSpeed;
    speedBtn.textContent = `${newSpeed}x`;
  });

  // Quality Selector
  const qualitySelect = document.createElement('select');
  qualitySelect.className = 'soc-ctrl-select soc-ctrl-quality soc-quality-select';
  qualitySelect.setAttribute('aria-label', 'Video Quality');

  function renderQualities(quals?: MediaQuality[]) {
    qualitySelect.innerHTML = '';
    if (quals && quals.length > 1) {
      quals.forEach((q) => {
        const opt = document.createElement('option');
        opt.value = q.url;
        opt.textContent = q.label;
        qualitySelect.appendChild(opt);
      });
      qualitySelect.style.display = 'inline-block';
    } else {
      qualitySelect.style.display = 'none';
    }
  }
  renderQualities(options?.qualities);

  // Fullscreen Button
  const fullscreenBtn = document.createElement('button');
  fullscreenBtn.className = 'soc-ctrl-btn soc-fullscreen-btn';
  fullscreenBtn.type = 'button';
  fullscreenBtn.setAttribute('aria-label', 'Fullscreen');
  fullscreenBtn.innerHTML = FULLSCREEN_SVG;

  // Append strictly into 1 single horizontal line
  overlay.appendChild(playPauseBtn);
  overlay.appendChild(timeDisplay);
  overlay.appendChild(timelineContainer);
  overlay.appendChild(volumeGroup);
  overlay.appendChild(speedBtn);
  overlay.appendChild(qualitySelect);
  overlay.appendChild(fullscreenBtn);

  mountPoint.appendChild(overlay);

  // State
  let isScrubbing = false;
  let hideTimeout: any = null;

  function updateTimeline() {
    const dur = getVideoDuration(video);
    const cur = video.currentTime || 0;
    const pct = dur > 0 ? (cur / dur) * 100 : 0;
    progressBar.style.width = `${pct}%`;
    thumb.style.left = `${pct}%`;
    timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;

    // Update buffered
    if (video.buffered && video.buffered.length > 0 && dur > 0) {
      let maxBuf = 0;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= cur && cur <= video.buffered.end(i)) {
          maxBuf = video.buffered.end(i);
          break;
        }
      }
      bufferedBar.style.width = `${(maxBuf / dur) * 100}%`;
    }
  }

  function scheduleAutoHide() {
    if (hideTimeout) clearTimeout(hideTimeout);
    if (!video.paused && !isScrubbing) {
      hideTimeout = setTimeout(() => {
        // Never autohide if user is hovering over the controls
        if (overlay.matches(':hover')) {
          scheduleAutoHide();
          return;
        }
        overlay.classList.add('soc-controls-hidden');
        overlay.classList.add('soc-hidden');
      }, 2500);
    }
  }

  function showControls() {
    if (hideTimeout) clearTimeout(hideTimeout);
    overlay.classList.remove('soc-controls-hidden');
    overlay.classList.remove('soc-hidden');
    scheduleAutoHide();
  }

  // Event Listeners on Video
  const onPlay = () => {
    playPauseBtn.innerHTML = PAUSE_SVG;
    showControls();
  };

  const onPause = () => {
    playPauseBtn.innerHTML = PLAY_SVG;
    if (hideTimeout) clearTimeout(hideTimeout);
    overlay.classList.remove('soc-controls-hidden');
    overlay.classList.remove('soc-hidden');
  };

  const onTimeUpdate = () => {
    if (!isScrubbing) updateTimeline();
  };

  video.addEventListener('play', onPlay);
  video.addEventListener('pause', onPause);
  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('loadedmetadata', updateTimeline);
  video.addEventListener('durationchange', updateTimeline);
  video.addEventListener('loadeddata', updateTimeline);
  video.addEventListener('canplay', updateTimeline);

  // Button interactions
  playPauseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  });

  qualitySelect.addEventListener('change', (e) => {
    e.stopPropagation();
    const newUrl = qualitySelect.value;
    const curTime = video.currentTime;
    const wasPaused = video.paused;

    video.src = newUrl;
    const onLoaded = () => {
      video.currentTime = curTime;
      if (!wasPaused) video.play();
      video.removeEventListener('loadedmetadata', onLoaded);
    };
    video.addEventListener('loadedmetadata', onLoaded);
  });

  fullscreenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const fsTarget = typeof mountPoint.requestFullscreen === 'function' ? mountPoint : video;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      fsTarget.requestFullscreen?.();
    }
  });

  // Timeline scrubbing & tooltip
  const seekToPosition = (clientX: number) => {
    const trackRect = timelineTrack.getBoundingClientRect();
    const rect = trackRect.width > 0 ? trackRect : timelineContainer.getBoundingClientRect();
    if (rect.width <= 0) return;

    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const dur = getVideoDuration(video);
    if (dur > 0) {
      const targetTime = Math.max(0, Math.min(dur, pos * dur));
      try {
        video.currentTime = targetTime;
      } catch {
        // Fallback or ignore
      }
    }
    progressBar.style.width = `${pos * 100}%`;
    thumb.style.left = `${pos * 100}%`;
  };

  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    isScrubbing = true;
    timelineContainer.classList.add('soc-scrubbing');
    if (typeof (timelineContainer as any).setPointerCapture === 'function') {
      try {
        (timelineContainer as any).setPointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
    }
    seekToPosition(e.clientX);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (isScrubbing) {
      e.stopPropagation();
      seekToPosition(e.clientX);
    }

    const trackRect = timelineTrack.getBoundingClientRect();
    const rect = trackRect.width > 0 ? trackRect : timelineContainer.getBoundingClientRect();
    if (rect.width > 0) {
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const dur = getVideoDuration(video);
      const hoverTime = pos * dur;
      tooltip.textContent = formatTime(hoverTime);
      tooltip.style.left = `${pos * 100}%`;
      tooltip.style.display = 'block';
    }
  };

  const endScrubbing = () => {
    if (isScrubbing) {
      isScrubbing = false;
      timelineContainer.classList.remove('soc-scrubbing');
      scheduleAutoHide();
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    endScrubbing();
    if (typeof (timelineContainer as any).releasePointerCapture === 'function') {
      try {
        (timelineContainer as any).releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
    }
  };

  // Global window listeners to ensure drag scrubbing continues outside timeline bounds
  const onGlobalPointerMove = (e: PointerEvent) => {
    if (isScrubbing) {
      seekToPosition(e.clientX);
    }
  };

  const onGlobalPointerUp = () => {
    endScrubbing();
  };

  const onTimelineClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    seekToPosition(e.clientX);
  };

  const onTimelineGenericIntercept = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  INTERCEPT_EVENTS.forEach((evt) => {
    if (evt === 'pointerdown') {
      timelineContainer.addEventListener('pointerdown', onPointerDown as any, { capture: true });
      timelineContainer.addEventListener('pointerdown', onPointerDown as any, { capture: false });
    } else if (evt === 'pointerup') {
      timelineContainer.addEventListener('pointerup', onPointerUp as any, { capture: true });
      timelineContainer.addEventListener('pointerup', onPointerUp as any, { capture: false });
    } else if (evt === 'click') {
      timelineContainer.addEventListener('click', onTimelineClick as any, { capture: true });
      timelineContainer.addEventListener('click', onTimelineClick as any, { capture: false });
    } else {
      timelineContainer.addEventListener(evt, onTimelineGenericIntercept as any, { capture: true });
      timelineContainer.addEventListener(evt, onTimelineGenericIntercept as any, { capture: false });
    }
  });

  timelineContainer.addEventListener('pointercancel', onPointerUp as any);
  timelineContainer.addEventListener('pointermove', onPointerMove as any);

  window.addEventListener('pointermove', onGlobalPointerMove);
  window.addEventListener('pointerup', onGlobalPointerUp);

  const onMouseLeaveTooltip = () => {
    tooltip.style.display = 'none';
  };
  timelineContainer.addEventListener('mouseleave', onMouseLeaveTooltip);

  // Activity tracking for autohide: Local element listeners
  const onMouseMoveActivity = () => {
    showControls();
  };

  mountPoint.addEventListener('mousemove', onMouseMoveActivity);
  mountPoint.addEventListener('mouseenter', onMouseMoveActivity);
  overlay.addEventListener('mousemove', onMouseMoveActivity);
  overlay.addEventListener('mouseenter', onMouseMoveActivity);

  // Global Document Mouse Tracking: Ensures controls reappear even when Instagram transparent tap overlays intercept events
  let lastDocMouseMove = 0;
  const onDocumentMouseMove = (e: MouseEvent) => {
    const now = Date.now();
    if (now - lastDocMouseMove < 50) return;
    lastDocMouseMove = now;

    const rect = video.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    if (
      e.clientX >= rect.left - 20 &&
      e.clientX <= rect.right + 20 &&
      e.clientY >= rect.top - 20 &&
      e.clientY <= rect.bottom + 20
    ) {
      showControls();
    }
  };

  document.addEventListener('mousemove', onDocumentMouseMove, { passive: true });

  updateTimeline();

  const destroy = () => {
    if (hideTimeout) clearTimeout(hideTimeout);
    video.removeEventListener('play', onPlay);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('timeupdate', onTimeUpdate);
    video.removeEventListener('loadedmetadata', updateTimeline);
    video.removeEventListener('durationchange', updateTimeline);
    video.removeEventListener('loadeddata', updateTimeline);
    video.removeEventListener('canplay', updateTimeline);
    video.removeEventListener('volumechange', onVolumeChange);
    video.removeEventListener('seeking', ensureUserAudioState);
    video.removeEventListener('seeked', ensureUserAudioState);
    video.removeEventListener('play', ensureUserAudioState);

    INTERCEPT_EVENTS.forEach((evt) => {
      overlay.removeEventListener(evt, onOverlayInterceptCapture, { capture: true } as any);
      overlay.removeEventListener(evt, onOverlayInterceptBubble, { capture: false } as any);
      if (evt === 'pointerdown') {
        timelineContainer.removeEventListener('pointerdown', onPointerDown as any, { capture: true } as any);
        timelineContainer.removeEventListener('pointerdown', onPointerDown as any, { capture: false } as any);
      } else if (evt === 'pointerup') {
        timelineContainer.removeEventListener('pointerup', onPointerUp as any, { capture: true } as any);
        timelineContainer.removeEventListener('pointerup', onPointerUp as any, { capture: false } as any);
      } else if (evt === 'click') {
        timelineContainer.removeEventListener('click', onTimelineClick as any, { capture: true } as any);
        timelineContainer.removeEventListener('click', onTimelineClick as any, { capture: false } as any);
      } else {
        timelineContainer.removeEventListener(evt, onTimelineGenericIntercept as any, { capture: true } as any);
        timelineContainer.removeEventListener(evt, onTimelineGenericIntercept as any, { capture: false } as any);
      }
    });
    timelineContainer.removeEventListener('pointercancel', onPointerUp as any);
    timelineContainer.removeEventListener('pointermove', onPointerMove as any);
    timelineContainer.removeEventListener('mouseleave', onMouseLeaveTooltip);

    mountPoint.removeEventListener('mousemove', onMouseMoveActivity);
    mountPoint.removeEventListener('mouseenter', onMouseMoveActivity);
    overlay.removeEventListener('mousemove', onMouseMoveActivity);
    overlay.removeEventListener('mouseenter', onMouseMoveActivity);
    document.removeEventListener('mousemove', onDocumentMouseMove);
    window.removeEventListener('pointermove', onGlobalPointerMove);
    window.removeEventListener('pointerup', onGlobalPointerUp);
    overlay.remove();
  };

  return {
    destroy,
    updateQualities: (quals: MediaQuality[]) => {
      renderQualities(quals);
    }
  };
}
