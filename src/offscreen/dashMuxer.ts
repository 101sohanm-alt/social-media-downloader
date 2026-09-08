import MP4Box from 'mp4box';
import { getRedditAudioCandidates } from '../shared/dashResolver';

/**
 * Multiplexes separate MP4 video and AAC/MP4 audio streams into a single synchronized MP4 Blob.
 */
export async function muxRedditDashStreams(videoUrl: string, audioUrl?: string): Promise<Blob> {
  // 1. Fetch video array buffer
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) {
    throw new Error(`Failed to fetch video stream: ${videoRes.status}`);
  }
  const videoBuffer = await videoRes.arrayBuffer();

  // 2. Determine audio candidate URLs
  const candidateUrls: string[] = [];
  if (audioUrl) candidateUrls.push(audioUrl);
  candidateUrls.push(...getRedditAudioCandidates(videoUrl));

  let audioBuffer: ArrayBuffer | null = null;
  for (const candidate of candidateUrls) {
    try {
      const aRes = await fetch(candidate);
      if (aRes.ok) {
        audioBuffer = await aRes.arrayBuffer();
        break;
      }
    } catch {
      // Continue to next candidate
    }
  }

  // If no audio stream was reachable, return original video stream
  if (!audioBuffer || audioBuffer.byteLength === 0) {
    return new Blob([videoBuffer], { type: 'video/mp4' });
  }

  // 3. Mux streams using MP4Box
  return new Promise((resolve) => {
    try {
      const outMp4 = MP4Box.createFile();
      const videoMp4 = MP4Box.createFile();
      const audioMp4 = MP4Box.createFile();

      let videoDone = false;
      let audioDone = false;

      const checkBothReady = () => {
        if (!videoDone || !audioDone) return;
        try {
          // Finalize and save
          const mime = 'video/mp4';
          const buffer = outMp4.getBuffer();
          resolve(new Blob([buffer], { type: mime }));
        } catch {
          // Fallback to video buffer if saving throws
          resolve(new Blob([videoBuffer], { type: 'video/mp4' }));
        }
      };

      // Handle video parsing
      videoMp4.onReady = (info: any) => {
        try {
          const vTrack = info.videoTracks[0];
          if (vTrack) {
            const outTrackId = outMp4.addTrack({
              type: 'video',
              width: vTrack.track_width,
              height: vTrack.track_height,
              timescale: vTrack.timescale,
              duration: vTrack.duration,
              nb_samples: vTrack.nb_samples,
              codec: vTrack.codec,
              avcDecoderConfigRecord: vTrack.avcConfig
            });

            videoMp4.setExtractionOptions(vTrack.id, null, { nbSamples: 1000 });
            videoMp4.onSamples = (_id: number, _user: any, samples: any[]) => {
              for (const sample of samples) {
                outMp4.addSample(outTrackId, sample.data, sample);
              }
              videoDone = true;
              checkBothReady();
            };
            videoMp4.start();
          } else {
            videoDone = true;
            checkBothReady();
          }
        } catch {
          videoDone = true;
          checkBothReady();
        }
      };

      // Handle audio parsing
      audioMp4.onReady = (info: any) => {
        try {
          const aTrack = info.audioTracks[0];
          if (aTrack) {
            const outTrackId = outMp4.addTrack({
              type: 'audio',
              timescale: aTrack.timescale,
              media_duration: aTrack.duration,
              samplerate: aTrack.audio.sample_rate,
              channel_count: aTrack.audio.channel_count,
              codec: aTrack.codec
            });

            audioMp4.setExtractionOptions(aTrack.id, null, { nbSamples: 1000 });
            audioMp4.onSamples = (_id: number, _user: any, samples: any[]) => {
              for (const sample of samples) {
                outMp4.addSample(outTrackId, sample.data, sample);
              }
              audioDone = true;
              checkBothReady();
            };
            audioMp4.start();
          } else {
            audioDone = true;
            checkBothReady();
          }
        } catch {
          audioDone = true;
          checkBothReady();
        }
      };

      // Feed buffers into MP4Box
      const vBuf: any = videoBuffer.slice(0);
      vBuf.fileStart = 0;
      videoMp4.appendBuffer(vBuf);
      videoMp4.flush();

      const aBuf: any = audioBuffer.slice(0);
      aBuf.fileStart = 0;
      audioMp4.appendBuffer(aBuf);
      audioMp4.flush();

      // Timeout safety: if not resolved within 3.5s, resolve with videoBuffer
      setTimeout(() => {
        resolve(new Blob([videoBuffer], { type: 'video/mp4' }));
      }, 3500);
    } catch {
      // Fallback
      resolve(new Blob([videoBuffer], { type: 'video/mp4' }));
    }
  });
}
