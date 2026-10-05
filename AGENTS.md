# AGENTS.md — social-media-downloader

MV3 Chrome extension (TS + Vite + Vitest/happy-dom): HD media download buttons + picker modal + custom video controls for Instagram, X, Reddit. No CI, no linter/formatter — `tsc` + tests are the gates.

## Commands

- `npm test` — full suite (`vitest run`, 98 tests / 16 files); single file: `npx vitest run tests/<name>.test.ts`; watch: `npm run test:watch`
- `npm run build` — **only** supported build: `tsc --noEmit && node scripts/build.js`. Do NOT run `vite build` directly (`vite.config.ts` is a stale legacy path; `build.js` calls vite with `configFile: false`).
- Manual check: `chrome://extensions` → Load unpacked → `dist/`. **Reload the card after every rebuild** — unpacked extensions do not hot-reload.

## Working in a worktree

`dist/` is gitignored, so a worktree build does **not** update the `dist/` Chrome loads from. After merging, rebuild in the main checkout or the extension keeps running the old bundle. To build in a worktree, symlink deps first: `ln -s ../../node_modules node_modules`. (Vitest then prints a harmless `ENOTDIR` cache-write warning at the end of a run; all tests still execute.)

## Manifest / CSS gotchas (both bit us before)

- Two manifests have diverged: **`public/manifest.json` is what ships** (`build.js` step 6). Editing `src/manifest.json` does nothing.
- Edit only `src/content/ui/styles.css` — it is copied verbatim to `dist/content/{ui/,}styles.css`. `public/content/styles.css` is a stale duplicate; ignore it.

## Architecture (worlds matter)

- `src/content/main_interceptor.ts` (**MAIN** world, `document_start`): monkey-patches `fetch`/`XHR`, parses JSON via `src/parsers/*` (pure functions — easiest unit-test seam), React-fiber inspection, dispatches `__SOC_MEDIA_INTERCEPTED__`.
- `src/content/isolated_bridge.ts` (**ISOLATED** world, `document_idle`): owns `mediaCache`, wires `src/content/platforms/{instagram,twitter,reddit}.ts` injectors. Message to background: `{ action: 'DOWNLOAD_MEDIA', items, forceAll }`.
- `src/background/` (service worker): `forceAll || explicit` bypasses the `autoDownloadAllCarousel` setting and downloads exactly the passed items.
- `src/offscreen/` + `mp4box`: remuxes Reddit DASH video+audio. `src/content/ui/`: `button.ts`, `pickerModal.ts`, `videoControls.ts`.
- Parsers (`src/parsers/`, `src/shared/`) are pure — put new extraction logic there with unit tests, not in injectors.
- `parseInstagramMedia` ends with a bounded `deepScanMediaItems` fallback for unknown Reel/clips JSON shapes; Reels also get one targeted fiber retry (blob: video ⇒ DOM fallback is empty by design).
- Twitter payloads are walked for **all** tweets by `traverseTweetNodes`/`collectAllTweetNodes` (`src/parsers/twitterParser.ts`), deduped by tweet id in `collectAllTweetNodes`. Do not reintroduce a first-match-only walker.

## Hard-won invariants (do not regress)

- `mediaCache` **merges, never overwrites** (`src/shared/mergeMedia.ts`): a later partial intercept must not wipe resolved slides. All three `mediaCache.set` sites in `src/content/platforms/instagram.ts` must either merge via `mergeMediaItems` or guard with `length > items.length` — an API refetch is best-effort and can return *fewer* items than the cache holds.
- Picker (`pickerModal.ts`): **one tile per item, always** — missing thumbnails fall back to numbered placeholders, never to a missing tile. Single instance; `closePickerModal()` in test `beforeEach`.
- Instagram completeness: `expectedTotal === 1` means **unknown**, not one slide. Swipe-collector (`collectCarouselSlidesBySwiping`) is last-resort for photo carousels only — never for video-only posts (posters ≠ photos). It restores slide position afterwards.
- Modal/dialog clicks must `stopPropagation()` — leaked clicks trigger Instagram timeline navigation.
- happy-dom rects are `0x0`: DOM-image collection must not treat zero-area rects as "too small" (only provably-tiny *rendered* images are excluded).
- Filenames flow through `normalizeBatchItems` (`index`/`total`); `mergeMediaItems` renumbers so `total` always matches the held set.
- `chrome.downloads` API facts that bite: `download()` resolves when the download **starts**, not when it completes; `erase()` takes no `removeFile` (and refuses to remove an incomplete file); `SERVER_NOT_FOUND` is **not** a `DownloadInterruptReason` (the real members are `SERVER_FAILED`, `SERVER_FORBIDDEN`, `SERVER_UNAUTHORIZED`, …).

## Known-broken (do not "fix" without live-page verification)

Listed so changes here are deliberate, not accidental:

- **Reddit DASH muxing is broken.** `dashMuxer.ts` passes `type: 'video'`/`'audio'` to mp4box `addTrack`, which looks up `BoxParser[type + 'SampleEntry']` — undefined for those names. `addTrack` returns `undefined` and every `addSample` silently no-ops, yielding a ~596-byte `ftyp`+`moov` shell with no `mdat`. It is still recorded `status: 'completed'`. The track-info object has no `avcConfig` property in mp4box 0.5.4 (so no `avcC`/`esds` is ever built); the config must be lifted off the source trak's `stsd.entries[0].boxes`. Any fix needs real Reddit media to validate — a naive "has samples" guard passes on a file that still decodes to zero frames.
- **Failed downloads report success.** `downloadManager.ts` writes `status: 'completed'` immediately after `chrome.downloads.download()` resolves with an id, and there is no `chrome.downloads.onChanged` listener anywhere. An expired/403 CDN URL yields no file and a green history row.
- **`document_start` → `document_idle` event loss.** `dispatchIntercepted` is one-shot with no queue/replay/handshake; payloads dispatched before the bridge attaches are dropped. Bounded to cold page loads, but real.
- **Failures are otherwise unobservable.** ~26 bare `catch {}` blocks by design; `downloadHistory` is written only downstream of a successful `download()`, so an empty history means nothing ever reached the browser download API.

## Debugging notes

- Verify changes landed in `dist/` **behaviorally**, not by grepping identifiers — the bundle is minified to one line and renames every local, so source names like `findTweetNode` or `mergeMediaItems` do not survive. Grep for stable structural markers instead (e.g. `new Set` for the cycle guard, `||[]` for the merge call).
- Content-script bundles: `main_interceptor.js` = MAIN world, `isolated_bridge.js` = ISOLATED world (platform injectors + UI live here).