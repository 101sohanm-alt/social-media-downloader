# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read AGENTS.md first

`AGENTS.md` is the canonical, detailed guide for this repo — invariants,
gotchas, and a known-broken list earned from real bugs. This file is the map;
that file is the territory. Do not duplicate its rules here; read it before
changing content scripts, parsers, or the native host.

## What this is

A Manifest V3 Chrome extension that adds HD download buttons to Instagram,
X/Twitter and Reddit, **plus a Rust native messaging host** that provides the
one thing an extension cannot do on its own: let you choose an arbitrary
destination folder.

That split is the single most important thing to understand. It is not a
half-finished migration — it is the boundary of what each runtime can reach:

| Runtime | Owns | Cannot do |
|---|---|---|
| Content scripts (TS) | fetch/XHR interception, DOM injection, parsers, UI | open a folder picker, write outside the browser sandbox |
| Service worker (TS) | download orchestration, settings, host fallback | touch the filesystem, survive without keep-alive |
| Native host (Rust) | folder dialog, file writes, `curl` transfers, `ffmpeg` mux | touch the page — it has no DOM and no browser context |

## Commands

```bash
npm test                                  # 142 tests / 18 files
npx vitest run tests/<name>.test.ts       # one file
npm run build                             # tsc --noEmit && node scripts/build.js

cd native-host && cargo test --release    # 21 Rust unit tests
node native-host/test-protocol.mjs        # 13 wire-protocol tests vs the real binary
bash scripts/install-native-host.sh       # build + install + register + smoke-test
```

`npm run build` is the **only** supported build. `vite build` directly hits a
stale legacy config; `build.js` re-invokes vite with `configFile: false` three
times (background/popup/offscreen, then the `main_interceptor` IIFE bundle, then
the `isolated_bridge` IIFE bundle) across six numbered steps that also place the
HTML, styles and manifest. `public/manifest.json` is what ships — editing
`src/manifest.json` does nothing.

`node native-host/test-protocol.mjs` is not optional after touching framing or
the reply shape: it is the only test that exercises the actual process boundary,
so it catches an endianness or length-width bug that every unit test passes.

## Architecture

### Two worlds in the page

`src/content/main_interceptor.ts` runs in the **MAIN** world at
`document_start` and monkey-patches `fetch`/`XMLHttpRequest` so media URLs are
captured before CORS applies. It hands payloads to the extension through a
one-shot `CustomEvent('__SOC_MEDIA_INTERCEPTED__')`.
`src/content/isolated_bridge.ts` runs in the **ISOLATED** world at
`document_idle`, owns `mediaCache`, and wires the per-platform injectors in
`src/content/platforms/`. The gap between those two timings loses events on cold
loads — a known, documented limitation, not an oversight.

### Extraction is pure, injection is not

`src/parsers/` and `src/shared/` are pure functions with **zero DOM references**
(verified). That is deliberate: it makes them the easiest unit-test seam, and it
is why the 142 tests can cover extraction at all. New extraction logic belongs
there, never in an injector.

### Download path and its fallback

`src/background/downloadManager.ts` tries the native host first and falls back to
`chrome.downloads`. The fallback is three-way, not binary — an *unusable* host
(absent, or blocked by policy) degrades to the browser path, but a host that
*actively refuses* is reported as a failure and never silently reroutes to
`~/Downloads`. Silent destination changes were the bug this replaced.

`src/background/nativeHost.ts` wraps the messaging bridge so every export
resolves with `{ok, value} | {ok: false, code, message}` and never throws, which
is what lets the caller fall back cleanly.

### The Rust host

`native-host/src/main.rs` speaks Chrome's native-messaging protocol: a 4-byte
native-endian length prefix plus JSON over stdin/stdout. Two dependencies only
(`serde`, `serde_json`) — no HTTP or TLS crate, because transfers shell out to
system `curl` and muxing to system `ffmpeg`. `native-host/DESIGN.md` explains
why, and records the service-worker lifetime rules and the filename-sanitisation
boundary.

**Media never crosses the bridge.** Chrome caps host→extension messages at 1 MB,
so the host writes the file itself and returns `{ok, path, bytes}`. Any design
that sends bytes through `sendNativeMessage` is wrong.

## Verifying changes

- Verify behaviour in `dist/`, not by grepping identifiers — the bundles are
  minified to one line and rename every local.
- Load the extension from **this checkout's** `dist/`. `dist/` is gitignored, so
  each worktree has its own build and the main checkout's copy will silently run
  old code.
- Native-host failures surface as vague messaging errors. The real reason is in
  Chrome's log; `AGENTS.md` has the `--enable-logging` grep and the triage order.
