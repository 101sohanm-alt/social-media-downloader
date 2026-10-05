# Omni Media — Universal HD Downloader

> A Manifest V3 Chrome Extension for downloading high-resolution photos, videos, multi-item carousels, and audio-synced media across **Instagram**, **X (Twitter)**, and **Reddit** with custom player controls and a boutique obsidian UI.

---

## ✨ Features

- **Multi-Platform Interception & Extraction**:
  - **Instagram**: Feed posts, Reels, and multi-slide carousels (with zero-swipe prefetching via authenticated endpoints & React Fiber inspection).
  - **X (Twitter)**: Single and multi-photo tweets, high-bitrate MP4 videos up to 1080p. Timeline and GraphQL payloads are walked for **every** tweet they carry, deduped by tweet id.
  - **Reddit**: Native video streams, galleries, and DASH audio+video stream remuxing via in-browser MP4Box offscreen documents.
- **Boutique Anti-AI-Slop Interface**:
  - Built with a deep obsidian palette (`#09090b`), surface glass cards, hairline borders, and high-contrast warm white buttons.
  - **Double-Bezel Architecture**: Interactive multi-item selection modal with nested squircle thumbnail containers and smooth checkmark toggles.
  - Custom macOS-style hardware switch for carousel download preferences.
- **Subtle 1-Line Video Player Controls**:
  - Single horizontal dark pill overlay (~36px height) with play/pause, elapsed/total time, full scrubber bar, volume slider, playback rate switcher (0.5x–2x), quality switcher, and fullscreen.
  - Smooth 2.5-second idle autohide during playback.
- **Custom Filename Templating**:
  - Tokenized file naming: `{platform}`, `{author}`, `{id}`, `{title}`, `{index}`, `{date}`, `{ext}`.
  - Downloads are routed into a single configurable subfolder (default `SocialDownloads`).
- **Download History**:
  - Popup drawer tracking the last **50** downloads with status indicators and one-click file access.

---

## 🛠 Tech Stack & Architecture

- **Manifest V3**:
  - `MAIN` World Script: Network monkey-patching for `fetch` and `XMLHttpRequest` to intercept media URLs before CORS restrictions apply.
  - `ISOLATED` World Content Script: DOM observers, UI button injection, interactive modal rendering, and custom video controls.
  - **Background Service Worker**: Coordinates downloads via `chrome.downloads` API, settings storage, and tab communications.
  - **Offscreen Document**: Handles DASH video + audio demuxing and remuxing using `mp4box.js` for Reddit video downloads.
- **Tooling**:
  - **TypeScript 5** for end-to-end type safety.
  - **Vite 5** custom multi-target bundling engine (`scripts/build.js`).
  - **Vitest & Happy-DOM** with 98 automated unit and integration tests across 16 files.

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or newer recommended)
- npm or yarn
- Google Chrome or Chromium-based browser (Brave, Edge, Arc)

### 1. Installation & Build

```bash
# Clone the repository
git clone https://github.com/101sohanm-alt/social-media-downloader.git
cd social-media-downloader

# Install dependencies
npm install

# Run automated tests
npm test

# Build for production
npm run build
```

The compiled extension files will be placed into the `dist/` directory.

> **Note:** `npm run build` is the only supported build command — it runs `tsc --noEmit` first, so a type error fails the build. Do not run `vite build` directly; `vite.config.ts` is a stale legacy path.

### 2. Load into Google Chrome

1. Open Google Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** using the toggle switch in the top-right corner.
3. Click the **Load unpacked** button in the top-left corner.
4. Select the `dist/` folder inside this project directory.
5. The **Omni Media - Universal HD Downloader** extension is now installed and active!

After any rebuild, hit the **Reload** button on the extension card in `chrome://extensions` — an unpacked extension does not hot-reload.

---

## 🧪 Testing

The codebase includes unit and integration tests covering parser extraction, video control logic, filename templating, DASH remuxing, and media selection state:

```bash
# Run all tests
npm test

# Run a single file
npx vitest run tests/<name>.test.ts

# Run tests in watch mode
npm run test:watch
```

---

## ⚠️ Known Limitations

These are real, currently-unfixed defects. Read this before trusting a download.

- **Reddit DASH video+audio muxing produces unplayable files.** The muxer passes `type: 'video'`/`'audio'` to mp4box, whose `addTrack` looks up a codec-keyed sample entry that does not exist under those names. `addTrack` returns `undefined`, every sample is silently dropped, and the result is a structurally invalid file with no media data — yet it is still recorded as a completed download. Prefer video-only for Reddit.
- **A failed download is reported as success.** `chrome.downloads.download()` resolves when a download *starts*, and the history entry is written as `completed` at that moment. An expired or 403 CDN URL produces no file, no error, and a green "Saved!" indicator. There is no `chrome.downloads.onChanged` listener, so true completion is never observed.
- **Cold loads can miss interception entirely.** The `MAIN`-world interceptor runs at `document_start`, but the `ISOLATED`-world bridge that consumes its events is attached at `document_idle`. Media dispatched in that window is lost — there is no queue or replay buffer between the two worlds.
- **Interception is passive, not requested.** The extension harvests media from JSON that happens to flow past the page. A post whose payload comes from cache, or arrives after the load being viewed, may yield no button at all — with no error shown.
- **No retry on download.** A transient failure is terminal on the first attempt.
- **Carousel completeness is best-effort.** The slide count is inferred from the DOM; when Instagram renders no `N/M` counter, recovery falls back to a swipe-collector that is photo-only by design and cannot rescue video-only posts.

---

## 📄 License

MIT License © 2025