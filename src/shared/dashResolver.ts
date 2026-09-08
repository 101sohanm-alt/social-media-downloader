/**
 * Resolves DASH audio stream URL for a Reddit video.
 */
export function resolveRedditDashAudioUrl(videoUrl: string): string | null {
  if (!videoUrl || !videoUrl.includes('v.redd.it')) {
    return null;
  }

  try {
    const parsed = new URL(videoUrl);
    // Replace DASH_xxx.mp4 with DASH_AUDIO_128.mp4
    parsed.pathname = parsed.pathname.replace(/DASH_[0-9a-zA-Z_]+\.mp4/i, 'DASH_AUDIO_128.mp4');
    parsed.search = '';
    return parsed.toString();
  } catch {
    const cleaned = videoUrl.replace(/DASH_[0-9a-zA-Z_]+\.mp4(\?.*)?$/i, 'DASH_AUDIO_128.mp4');
    return cleaned.split('?')[0];
  }
}

/**
 * Generates prioritized audio stream candidate URLs for Reddit video.
 */
export function getRedditAudioCandidates(videoUrl: string): string[] {
  if (!videoUrl || !videoUrl.includes('v.redd.it')) {
    return [];
  }

  try {
    const parsed = new URL(videoUrl);
    const basePath = parsed.pathname.replace(/DASH_[0-9a-zA-Z_]+\.mp4/i, '');
    const origin = parsed.origin;

    return [
      `${origin}${basePath}DASH_AUDIO_128.mp4`,
      `${origin}${basePath}DASH_audio.mp4`,
      `${origin}${basePath}DASH_AUDIO_64.mp4`,
      `${origin}${basePath}audio.mp4`
    ];
  } catch {
    const base = videoUrl.replace(/DASH_[0-9a-zA-Z_]+\.mp4(\?.*)?$/i, '');
    return [
      `${base}DASH_AUDIO_128.mp4`,
      `${base}DASH_audio.mp4`,
      `${base}DASH_AUDIO_64.mp4`,
      `${base}audio.mp4`
    ];
  }
}
