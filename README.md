# Omni Media — Universal HD Downloader

> A Manifest V3 Chrome Extension for downloading high-resolution photos, videos, multi-item carousels, and audio-synced media across **Instagram**, **X (Twitter)**, and **Reddit** with custom player controls and a boutique obsidian UI.

---

## ✨ Features

- **Multi-Platform Interception & Extraction**:
  - **Instagram**: Feed posts, Reels, and multi-slide carousels (with zero-swipe prefetching via authenticated endpoints & React Fiber inspection).
  - **X (Twitter)**: Single and multi-photo tweets, high-bitrate MP4 videos up to 1080p.
  - **Reddit**: Native video streams, galleries, and DASH audio+video stream remuxing via in-browser MP4Box offscreen documents.
- **Boutique Anti-AI-Slop Interface**:
  - Built with a deep obsidian palette (`#09090b`), surface glass cards, hairline borders, and high-contrast warm white buttons.
  - **Double-Bezel Architecture**: Interactive multi-item selection modal with nested squircle thumbnail containers and smooth checkmark toggles.
  - Custom macOS-style hardware switch for carousel download preferences.
- **Subtle 1-Line Video Player Controls**:
  - Single horizontal dark pill overlay (~36px height) with play/pause, elapsed/total time, full scrubber bar, volume slider, playback rate switcher (0.5x–2x), quality switcher, and fullscreen.
  - Smooth 2.5-second idle autohide during playback.
- **Custom Filename Templating**:
  - Tokenized file naming support: `{platform}`, `{author}`, `{id}`, `{index}`, `{date}`, `{type}`.
  - Auto-subfolder routing by platform (e.g. `Downloads/OmniMedia/Instagram/...`).
- **Download History & Retry**:
  - Popup drawer tracking recent downloads with status indicators, one-click file access, and error retry.

---

## 🛠 Tech Stack & Architecture

- **Manifest V3**:
  - `MAIN` World Script: Network monkey-patching for `fetch` and `XMLHttpRequest` to intercept media URLs before CORS restrictions apply.
  - `ISOLATED` World Content Script: DOM observers, UI button injection, interactive modal rendering, and custom video controls.
  - `Background Service Worker`: Coordinates downloads via `chrome.downloads` API, settings storage, and tab communications.
  - `Offscreen Document`: Handles DASH video + audio demuxing and remuxing using `mp4box.js` for Reddit video downloads with full audio track preservation.
- **Tooling**:
  - **TypeScript 5** for end-to-end type safety.
  - **Vite 5** custom multi-target bundling engine (`scripts/build.js`).
  - **Vitest & Happy-DOM** with 43 automated unit and integration tests.

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or newer recommended)
- npm or yarn
- Google Chrome or Chromium-based browser (Brave, Edge, Arc)

### 1. Installation & Build

```bash
# Clone the repository
git clone https://github.com/<your-username>/omni-media-downloader.git
cd omni-media-downloader

# Install dependencies
npm install

# Run automated tests
npm test

# Build for production
npm run build
```

The compiled extension files will be placed into the `dist/` directory.

### 2. Load into Google Chrome

1. Open Google Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** using the toggle switch in the top-right corner.
3. Click the **Load unpacked** button in the top-left corner.
4. Select the `dist/` folder inside this project directory.
5. The **Omni Media - Universal HD Downloader** extension is now installed and active!

---

## 🧪 Testing

The codebase includes comprehensive unit and integration tests covering parser extraction, video control logic, filename templating, DASH remuxing, and media selection state:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

---

## 📄 License

MIT License © 2025
