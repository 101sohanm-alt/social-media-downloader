# AGENTS.md — social-media-downloader

MV3 Chrome extension (TS + Vite + Vitest/happy-dom): HD media download buttons + picker modal + custom video controls for Instagram, X, Reddit, plus a **Rust native messaging host** that owns the destination-folder picker, the file transfer and DASH remuxing. No CI, no linter/formatter — `tsc` + tests are the gates.

## Commands

- `npm test` — full suite (`vitest run`, 139 tests / 17 files); single file: `npx vitest run tests/<name>.test.ts`; watch: `npm run test:watch`
- `npm run build` — **only** supported build: `tsc --noEmit && node scripts/build.js`. Do NOT run `vite build` directly (`vite.config.ts` is a stale legacy path; `build.js` calls vite with `configFile: false`).
- `cd native-host && cargo test --release` — 21 Rust unit tests
- `node native-host/test-protocol.mjs` — 13 wire-protocol tests against the real binary over stdin/stdout. Run this after ANY change to the framing or the reply shape; unit tests cannot catch an endianness or length-width bug.
- `bash scripts/install-native-host.sh` — build, install and register the host, then smoke-test it
- Manual check: `chrome://extensions` → Load unpacked → `dist/`. **Reload the card after every rebuild** — unpacked extensions do not hot-reload.

## Working in a worktree

`dist/` is gitignored, so a worktree build does **not** update the `dist/` Chrome loads from. After merging, rebuild in the main checkout or the extension keeps running the old bundle. To build in a worktree, symlink deps first: `ln -s ../../node_modules node_modules`. (Vitest then prints a harmless `ENOTDIR` cache-write warning at the end of a run; all tests still execute.)

**Load the extension from the worktree's own `dist/`** while developing on a branch — pointing Chrome at the main checkout's `dist/` silently runs the old code.

## The Rust native host — read this before touching either side

A Chrome extension **cannot** open a folder picker: `showDirectoryPicker()` is
broken in extension contexts on macOS (crbug 40240444 — rejects with "the user
aborted a request" even when OK is pressed, crashes Chrome in a side panel), and
`chrome.downloads` only ever writes inside `~/Downloads`. That is why the
destination folder lives in a native process. `native-host/DESIGN.md` has the
full rationale; the invariants are:

- **Media never crosses the bridge.** Chrome caps host→extension messages at
  1 MB. The host writes the file and returns `{ok, path, bytes}`. Any design that
  sends bytes through `sendNativeMessage` is wrong.
- **The reply contract is shared.** `src/background/nativeHost.ts` and
  `native-host/src/main.rs` must agree on every field. Change one, change the
  other, and run `node native-host/test-protocol.mjs`.
- **`path` is always present in a reply**, `null` when no folder is chosen.
  `skip_serializing_if` on that field was a bug: it made "no folder" and
  "field absent" indistinguishable.
- **A transfer timeout is `pending`, never `failed`.** The host is a separate
  process that keeps downloading after the extension stops waiting, so `failed`
  would be a red row over a file that exists.
- **Chrome does not kill the worker mid-transfer.** Native messaging carries a
  strong keep-alive that cancels both the 30 s idle timer and the 5-minute event
  cap (developer.chrome.com/blog/longer-esw-lifetimes). Do not re-derive a
  5-minute budget from the generic lifecycle page — it does not apply.
- **Telemetry/diagnostics go to stderr, never stdout.** stdout is the protocol
  stream; one stray `println!` corrupts the next frame.
- **`native-host/target/` is gitignored.** Do not commit build artifacts.

## Manifest / CSS gotchas (both bit us before)

- Two manifests have diverged: **`public/manifest.json` is what ships** (`build.js` step 6). Editing `src/manifest.json` does nothing.
- The shipping manifest pins a **`key`**, which fixes the extension ID at `jddkdffbpaddbipcicajehacdogcdagg`. Without it an unpacked extension's ID derives from its absolute path, so moving the folder would break the host's `allowed_origins` with only "Specified native messaging host not found" as the symptom. **`.extension-key` is the private half — it is gitignored and must never be committed.**
- `nativeMessaging` must be in `permissions`, or `chrome.runtime.sendNativeMessage` is unavailable and every host call fails.
- Edit only `src/content/ui/styles.css` — it is copied verbatim to `dist/content/{ui/,}styles.css`. `public/content/styles.css` is a stale duplicate; ignore it.

## Architecture (worlds matter)

- `src/content/main_interceptor.ts` (**MAIN** world, `document_start`): monkey-patches `fetch`/`XHR`, parses JSON via `src/parsers/*` (pure functions — easiest unit-test seam), React-fiber inspection, dispatches `__SOC_MEDIA_INTERCEPTED__`.
- `src/content/isolated_bridge.ts` (**ISOLATED** world, `document_idle`): owns `mediaCache`, wires `src/content/platforms/{instagram,twitter,reddit}.ts` injectors. Message to background: `{ action: 'DOWNLOAD_MEDIA', items, forceAll }`.
- `src/background/` (service worker): `forceAll || explicit` bypasses the `autoDownloadAllCarousel` setting and downloads exactly the passed items.
- `src/offscreen/` + `mp4box`: **legacy** in-browser DASH remuxer, superseded by the native host's `ffmpeg` path. Kept as the fallback when the host is absent. `src/content/ui/`: `button.ts`, `pickerModal.ts`, `videoControls.ts`.
- `src/background/nativeHost.ts`: typed client for the Rust host. Every export resolves (never throws) with `{ok:true,value} | {ok:false,code,message}` so callers can fall back. `hostAvailable()` memoises for 60 s and de-dupes concurrent pings, so a 10-slide carousel spawns one host process, not ten.
- `native-host/src/main.rs`: the host. `osascript` for the folder dialog, `curl` for transfers (`.part` then rename), `ffmpeg` for mux with stream verification. Two dependencies only (`serde`, `serde_json`) — deliberately no HTTP/TLS crate; see `native-host/DESIGN.md` for why.
- Parsers (`src/parsers/`, `src/shared/`) are pure — **zero DOM references**, verified. Put new extraction logic there with unit tests, not in injectors. This purity is also what would make them portable to Rust-as-WASM if that is ever wanted.
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
- `DOWNLOAD_VERIFY_DELAY_MS` (400 ms) exists because of the first fact above: the fallback path re-reads the download once so an immediate 403 does not get recorded as `completed`. It only ever rejects a *provable* failure — in-progress, missing item or unavailable API all count as "started".

## Known-broken (do not "fix" without live-page verification)

Listed so changes here are deliberate, not accidental:

- **`document_start` → `document_idle` event loss.** `dispatchIntercepted` is one-shot with no queue/replay/handshake; payloads dispatched before the bridge attaches are dropped. Bounded to cold page loads, but real.
- **Failures are otherwise unobservable.** ~26 bare `catch {}` blocks by design; `downloadHistory` is written only downstream of a successful `download()`, so an empty history means nothing ever reached the browser download API.
- **`pending` is terminal.** A timed-out host transfer is recorded `pending` and nothing ever reconciles it. The fix is a `status` command on the host plus a `chrome.alarms` sweep over `inflight` records — designed, not built.
- **Reddit DASH muxing is verified only against generated media**, never a live Reddit payload. Prefer Instagram/X when testing the happy path.

### Fixed — kept so these are not reintroduced

- ~~`dashMuxer.ts` passes `type: 'video'`/`'audio'` to mp4box `addTrack`~~, which looks up `BoxParser[type + 'SampleEntry']`, returns `undefined`, and silently no-ops every sample into a ~596-byte shell recorded as `completed`. Superseded by the native `ffmpeg` path, which verifies the output holds both streams. `dashMuxer.ts` remains only as the no-host fallback.
- ~~`downloadManager.ts` writes `status: 'completed'` immediately after `download()` resolves~~ — the host path writes only after the file exists, and the fallback re-reads once.
- ~~`get_folder` omitted `path` when no folder was set~~ — the field is now always present (`null` when unset), so "no folder" and "field missing" are distinguishable.

## Debugging notes

- Verify changes landed in `dist/` **behaviorally**, not by grepping identifiers — the bundle is minified to one line and renames every local, so source names like `findTweetNode` or `mergeMediaItems` do not survive. Grep for stable structural markers instead (e.g. `new Set` for the cycle guard, `||[]` for the merge call).
- Content-script bundles: `main_interceptor.js` = MAIN world, `isolated_bridge.js` = ISOLATED world (platform injectors + UI live here).
- Native-host failures are silent from the extension's side. Log the real reason with:
  `/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --enable-logging=stderr --log-level=1 2>&1 | grep -E "native_messag|launch_context"`
  Then check, in order: host manifest exists → its `path` is absolute and executable → `allowed_origins` matches `chrome.runtime.id` exactly.
- **Protocol framing is a 4-byte native-endian length prefix + JSON.** When hand-testing with `printf`, compute the length — a hardcoded prefix that disagrees with the payload makes a working binary look dead (this exact bug shipped once in `install-native-host.sh`), and `printf` needs `%b`, not `%s`, to expand escapes:
  `printf '%b%s' "$(printf '\\%03o' 14)\\000\\000\\000" '{"cmd":"ping"}' | <binary> | tail -c +5`
