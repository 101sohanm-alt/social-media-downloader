# Omni Media — Universal HD Downloader

> A Manifest V3 Chrome Extension for downloading high-resolution photos, videos, multi-item carousels, and audio-synced media across **Instagram**, **X (Twitter)**, and **Reddit** with custom player controls and a boutique obsidian UI.

---

## ✨ Features

- **Multi-Platform Interception & Extraction**:
  - **Instagram**: Feed posts, Reels, and multi-slide carousels (with zero-swipe prefetching via authenticated endpoints & React Fiber inspection).
  - **X (Twitter)**: Single and multi-photo tweets, high-bitrate MP4 videos up to 1080p. Timeline and GraphQL payloads are walked for **every** tweet they carry, deduped by tweet id.
  - **Reddit**: Native video streams and galleries. DASH audio+video remuxing is delegated to a native Rust host running `ffmpeg`, with the output verified to actually contain both streams.
- **Any destination folder you like**:
  - A native macOS folder picker, not a typed subfolder name. Pick `~/Movies`, an external drive, anywhere writable; the choice persists.
  - A Chrome extension cannot do this on its own — see [Why there is a native host](#-why-there-is-a-native-host). With the host absent the extension still works and falls back to `~/Downloads`.
- **Boutique Anti-AI-Slop Interface**:
  - Built with a deep obsidian palette (`#09090b`), surface glass cards, hairline borders, and high-contrast warm white buttons.
  - **Double-Bezel Architecture**: Interactive multi-item selection modal with nested squircle thumbnail containers and smooth checkmark toggles.
  - Custom macOS-style hardware switch for carousel download preferences.
- **Subtle 1-Line Video Player Controls**:
  - Single horizontal dark pill overlay (~36px height) with play/pause, elapsed/total time, full scrubber bar, volume slider, playback rate switcher (0.5x–2x), quality switcher, and fullscreen.
  - Smooth 2.5-second idle autohide during playback.
- **Custom Filename Templating**:
  - Tokenized file naming: `{platform}`, `{author}`, `{id}`, `{title}`, `{index}`, `{date}`, `{ext}`.
  - Destinations are path-sanitised in Rust: separators, `..`, control characters and reserved characters are stripped, so a scraped title can never escape the chosen folder.
- **Download History**:
  - Popup drawer tracking the last **50** downloads with status indicators (`completed` / `failed` / `pending`) and one-click file access.

---

## 🛠 Tech Stack & Architecture

- **Manifest V3**:
  - `MAIN` World Script: Network monkey-patching for `fetch` and `XMLHttpRequest` to intercept media URLs before CORS restrictions apply.
  - `ISOLATED` World Content Script: DOM observers, UI button injection, interactive modal rendering, and custom video controls.
  - **Background Service Worker**: Coordinates downloads, settings storage, and tab communications. Prefers the native host; falls back to `chrome.downloads`.
  - **Native messaging host (Rust)**: Owns the folder picker, the file transfer, and DASH remuxing. See below.
- **Tooling**:
  - **TypeScript 5** for end-to-end type safety.
  - **Rust 2021** for the native host — 942 lines, two dependencies (`serde`, `serde_json`), 420 KB release binary.
  - **Vite 5** custom multi-target bundling engine (`scripts/build.js`).
  - **Vitest & Happy-DOM** — 139 tests across 17 files; **`cargo test`** — 21 unit tests; `native-host/test-protocol.mjs` — 13 wire-protocol tests against the real binary.

---

## 🦀 Why there is a native host

A Manifest V3 extension **cannot let you choose a destination folder**. This is a
platform limit, not a shortcut:

| Approach | Why it doesn't work |
|---|---|
| `showDirectoryPicker()` | Broken in extension contexts on macOS. Rejects with *"the user aborted a request"* even when OK is pressed, and **crashes Chrome** in a side panel. [crbug 40240444](https://issues.chromium.org/issues/40240444), still open. |
| `chrome.downloads.download()` | Only ever writes inside the Downloads folder — relative subpaths, no `..`. |
| `chrome.fileSystem` | ChromeOS only. |

So the folder dialog and the disk write live in a native process, which Chrome
launches and talks to over stdio:

```
page ──► content script ──► service worker ──► sendNativeMessage
                                                     │ 4-byte LE length + JSON
                                                     ▼
                                              omni-native-host
                                               ├─ osascript "choose folder"
                                               ├─ curl  → .part → rename
                                               └─ ffmpeg → stream verification
```

Media never crosses the bridge: Chrome caps host→extension messages at 1 MB, so
the host writes the file and returns `{ok, path, bytes}`. Full design notes,
including the service-worker lifetime rules and the filename-sanitisation
boundary, are in [`native-host/DESIGN.md`](native-host/DESIGN.md).

### Installing the host

```bash
cd native-host && cargo build --release && cd ..
bash scripts/install-native-host.sh
```

The installer copies the binary to `~/Library/Application Support/omni-media-downloader/bin/`,
ad-hoc signs it, writes the Chrome host manifest, and smoke-tests the wire protocol.
Requires `ffmpeg` (`brew install ffmpeg`) for Reddit DASH remuxing.

The extension ID is **pinned** via the `key` field in `public/manifest.json`, so
moving the project folder does not change it — an unpacked extension's ID is
otherwise derived from its absolute path, which would silently break the host's
`allowed_origins`. **The private half lives in `.extension-key` and is gitignored.
Never commit it.**

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or newer recommended)
- npm or yarn
- Google Chrome or Chromium-based browser (Brave, Edge, Arc)
- **Rust (1.70+)** and **ffmpeg** — only for the optional native host. Without them the extension builds and runs, writing to `~/Downloads`.

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

**If you work in a git worktree, load `dist/` from that worktree**, not from the
main checkout. `dist/` is gitignored, so every checkout has its own build and the
main one will not contain your changes.

When the native host is installed, the popup shows a **Choose Folder…** button
and a connection status. If it reads "not installed" right after setup, quit
Chrome completely and reopen it — Chrome caches native-host manifests at startup.

---

## 🧪 Testing

The codebase includes unit and integration tests covering parser extraction, video control logic, filename templating, DASH remuxing, and media selection state:

```bash
# Run all extension tests (139 across 17 files)
npm test

# Run a single file
npx vitest run tests/<name>.test.ts

# Run tests in watch mode
npm run test:watch

# Native host: 21 unit tests
cd native-host && cargo test --release

# Native host: 13 wire-protocol tests against the real binary over stdio
node native-host/test-protocol.mjs
```

---

## ⚠️ Known Limitations

These are real, currently-unfixed defects. Read this before trusting a download.

- **Cold loads can miss interception entirely.** The `MAIN`-world interceptor runs at `document_start`, but the `ISOLATED`-world bridge that consumes its events is attached at `document_idle`. Media dispatched in that window is lost — there is no queue or replay buffer between the two worlds.
- **Interception is passive, not requested.** The extension harvests media from JSON that happens to flow past the page. A post whose payload comes from cache, or arrives after the load being viewed, may yield no button at all — with no error shown.
- **No retry on download.** A transient failure is terminal on the first attempt.
- **Carousel completeness is best-effort.** The slide count is inferred from the DOM; when Instagram renders no `N/M` counter, recovery falls back to a swipe-collector that is photo-only by design and cannot rescue video-only posts.
- **A timed-out transfer is reported as `pending`, not resolved.** The host runs in its own process and may still finish after the extension stops waiting. There is no reconciliation sweep yet, so a `pending` row stays pending. Chrome does *not* kill the worker mid-transfer — native messaging carries a strong keep-alive that cancels the idle and 5-minute timers — so this is a rare path rather than the common one.
- **Reddit DASH remuxing is the least-tested path.** It needs `ffmpeg` installed. Stream detection is verified against generated media, but not against live Reddit payloads.

### Recently fixed

Kept for context, since earlier versions of this extension had these bugs:

- ~~Reddit DASH muxing produced unplayable files~~ — the in-browser mp4box muxer was replaced by a native `ffmpeg` host that verifies the output contains both a video and an audio stream before reporting success. The old muxer exited "successfully" with a ~596-byte shell.
- ~~A failed download was reported as success~~ — the host path only records `completed` after the file is written, and the `chrome.downloads` fallback now re-reads the download once to catch an immediate 403/expired-URL interruption.
- ~~Downloads were confined to `~/Downloads/<subfolder>`~~ — see [Why there is a native host](#-why-there-is-a-native-host).

---

## 📚 Further reading

- [`AGENTS.md`](AGENTS.md) — architecture, invariants and known-broken list for agents working in this repo
- [`native-host/DESIGN.md`](native-host/DESIGN.md) — why the native host exists, the messaging protocol, service-worker lifetime rules, and the filename-sanitisation boundary

---

## 📄 License

MIT License © 2025