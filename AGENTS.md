# AGENTS.md — social-media-downloader

MV3 Chrome extension (TS + Vite + Vitest/happy-dom): HD media download buttons + picker modal + custom video controls for Instagram, X, Reddit. No CI, no linter/formatter — `tsc` + tests are the gates.

## Commands

- `npm test` — full suite (`vitest run`); single file: `npx vitest run tests/<name>.test.ts`; watch: `npm run test:watch`
- `npm run build` — **only** supported build: `tsc --noEmit && node scripts/build.js`. Do NOT run `vite build` directly (`vite.config.ts` is a stale legacy path; `build.js` calls vite with `configFile: false`).
- Manual check: `chrome://extensions` → Load unpacked → `dist/`

## Manifest / CSS gotchas (both bit us before)

- Two manifests have diverged: **`public/manifest.json` is what ships** (`build.js` step 6). Editing `src/manifest.json` does nothing.
- Edit only `src/content/ui/styles.css` — it is copied verbatim to `dist/content/{ui/,}styles.css`. `public/content/styles.css` is a stale duplicate; ignore it.

## Architecture (worlds matter)

- `src/content/main_interceptor.ts` (**MAIN** world, `document_start`): monkey-patches `fetch`/`XHR`, parses JSON via `src/parsers/*` (pure functions — easiest unit-test seam), React-fiber inspection, dispatches `__SOC_MEDIA_INTERCEPTED__`.
- `src/content/isolated_bridge.ts` (**ISOLATED** world): owns `mediaCache`, wires `src/content/platforms/{instagram,twitter,reddit}.ts` injectors. Message to background: `{ action: 'DOWNLOAD_MEDIA', items, forceAll }`.
- `src/background/` (service worker): `forceAll || explicit` bypasses the `autoDownloadAllCarousel` setting and downloads exactly the passed items.
- `src/offscreen/` + `mp4box`: remuxes Reddit DASH video+audio. `src/content/ui/`: `button.ts`, `pickerModal.ts`, `videoControls.ts`.
- Parsers (`src/parsers/`, `src/shared/`) are pure — put new extraction logic there with unit tests, not in injectors.
- `parseInstagramMedia` ends with a bounded `deepScanMediaItems` fallback for unknown Reel/clips JSON shapes; Reels also get one targeted fiber retry (blob: video ⇒ DOM fallback is empty by design).

## Hard-won invariants (do not regress)

- `mediaCache` **merges, never overwrites** (`src/shared/mergeMedia.ts`): a later partial intercept must not wipe resolved slides.
- Picker (`pickerModal.ts`): **one tile per item, always** — missing thumbnails fall back to numbered placeholders, never to a missing tile. Single instance; `closePickerModal()` in test `beforeEach`.
- Instagram completeness: `expectedTotal === 1` means **unknown**, not one slide. Swipe-collector (`collectCarouselSlidesBySwiping`) is last-resort for photo carousels only — never for video-only posts (posters ≠ photos). It restores slide position afterwards.
- Modal/dialog clicks must `stopPropagation()` — leaked clicks trigger Instagram timeline navigation.
- happy-dom rects are `0x0`: DOM-image collection must not treat zero-area rects as "too small" (only provably-tiny *rendered* images are excluded).
- Filenames flow through `normalizeBatchItems` (`index`/`total`); `mergeMediaItems` renumbers so `total` always matches the held set.
