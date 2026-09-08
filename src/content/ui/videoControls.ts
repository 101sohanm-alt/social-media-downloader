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

export function attachVideoControls(
  video: HTMLVideoElement,
  targetContainer?: HTMLElement,
  options?: VideoControlsOptions
): VideoControlsController {
  const mountPoint = targetContainer || video.parentElement || video;

  // Build UI element
  const overlay = document.createElement('div');
  overlay.className = 'soc-video-controls';

  // Prevent event propagation to host page
  ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'touchstart'].forEach((evt) => {
    overlay.addEventListener(evt, (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    });
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
  timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration || 0)}`;

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

  // Append strictly into 1 single horizontal line (No volume controls)
  overlay.appendChild(playPauseBtn);
  overlay.appendChild(timeDisplay);
  overlay.appendChild(timelineContainer);
  overlay.appendChild(speedBtn);
  overlay.appendChild(qualitySelect);
  overlay.appendChild(fullscreenBtn);

  mountPoint.appendChild(overlay);

  // State
  let isScrubbing = false;
  let hideTimeout: any = null;

  function updateTimeline() {
    const dur = video.duration || 0;
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
        overlay.classList.add('soc-controls-hidden');
        overlay.classList.add('soc-hidden');
      }, 2500);
    }
  }

  function showControls() {
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
    const dur = video.duration;
    if (isFinite(dur) && dur > 0) {
      const targetTime = Math.max(0, Math.min(dur, pos * dur));
      try {
        video.currentTime = targetTime;
      } catch (err) {
        // Fallback or ignore
      }
    }
    progressBar.style.width = `${pos * 100}%`;
    thumb.style.left = `${pos * 100}%`;
  };

  const onPointerDown = (e: PointerEvent) => {
    e.stopPropagation();
    isScrubbing = true;
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
      const dur = video.duration || 0;
      const hoverTime = pos * dur;
      tooltip.textContent = formatTime(hoverTime);
      tooltip.style.left = `${pos * 100}%`;
      tooltip.style.display = 'block';
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (isScrubbing) {
      e.stopPropagation();
      isScrubbing = false;
      if (typeof (timelineContainer as any).releasePointerCapture === 'function') {
        try {
          (timelineContainer as any).releasePointerCapture(e.pointerId);
        } catch {
          // Ignore
        }
      }
      scheduleAutoHide();
    }
  };

  timelineContainer.addEventListener('pointerdown', onPointerDown as any);
  timelineContainer.addEventListener('pointermove', onPointerMove as any);
  timelineContainer.addEventListener('pointerup', onPointerUp as any);
  timelineContainer.addEventListener('pointercancel', onPointerUp as any);

  // Mouse fallback for click / mousedown
  timelineContainer.addEventListener('click', (e) => {
    e.stopPropagation();
    seekToPosition(e.clientX);
  });

  timelineContainer.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });

  // Activity tracking for autohide
  const onMouseMoveActivity = () => {
    showControls();
  };

  mountPoint.addEventListener('mousemove', onMouseMoveActivity);
  mountPoint.addEventListener('mouseenter', onMouseMoveActivity);

  updateTimeline();

  const destroy = () => {
    if (hideTimeout) clearTimeout(hideTimeout);
    video.removeEventListener('play', onPlay);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('timeupdate', onTimeUpdate);
    video.removeEventListener('loadedmetadata', updateTimeline);
    mountPoint.removeEventListener('mousemove', onMouseMoveActivity);
    mountPoint.removeEventListener('mouseenter', onMouseMoveActivity);
    overlay.remove();
  };

  return {
    destroy,
    updateQualities: (quals: MediaQuality[]) => {
      renderQualities(quals);
    }
  };
}
