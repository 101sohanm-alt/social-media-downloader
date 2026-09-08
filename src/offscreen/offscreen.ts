import { muxRedditDashStreams } from './dashMuxer';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'MUX_REDDIT_DASH') {
    const { videoUrl, audioUrl } = message;
    muxRedditDashStreams(videoUrl, audioUrl)
      .then((blob) => blobToDataUrl(blob))
      .then((dataUrl) => {
        sendResponse({ success: true, dataUrl });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open for async response
  }
});
