import { describe, it, expect } from 'vitest';
import { resolveRedditDashAudioUrl, getRedditAudioCandidates } from '../src/shared/dashResolver';

describe('Reddit DASH Resolver', () => {
  it('constructs valid audio stream URL from video fallback URL with query params', () => {
    const videoUrl = 'https://v.redd.it/abcdef/DASH_1080.mp4?source=fallback';
    const audioUrl = resolveRedditDashAudioUrl(videoUrl);
    expect(audioUrl).toBe('https://v.redd.it/abcdef/DASH_AUDIO_128.mp4');
  });

  it('constructs valid audio stream URL from simple video fallback URL', () => {
    const videoUrl = 'https://v.redd.it/xyz987/DASH_720.mp4';
    const audioUrl = resolveRedditDashAudioUrl(videoUrl);
    expect(audioUrl).toBe('https://v.redd.it/xyz987/DASH_AUDIO_128.mp4');
  });

  it('generates prioritized audio candidates list', () => {
    const videoUrl = 'https://v.redd.it/12345/DASH_480.mp4?source=fallback';
    const candidates = getRedditAudioCandidates(videoUrl);
    expect(candidates).toContain('https://v.redd.it/12345/DASH_AUDIO_128.mp4');
    expect(candidates).toContain('https://v.redd.it/12345/DASH_audio.mp4');
    expect(candidates).toContain('https://v.redd.it/12345/DASH_AUDIO_64.mp4');
    expect(candidates).toContain('https://v.redd.it/12345/audio.mp4');
  });

  it('returns null if video is not hosted on v.redd.it', () => {
    const videoUrl = 'https://example.com/video.mp4';
    const audioUrl = resolveRedditDashAudioUrl(videoUrl);
    expect(audioUrl).toBeNull();
    const candidates = getRedditAudioCandidates(videoUrl);
    expect(candidates).toHaveLength(0);
  });
});
