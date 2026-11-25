# Native host — design notes and known limits

The Chrome extension cannot let the user pick an arbitrary destination folder.
That is a platform limit, not something this project worked around by choice:

| Approach | Why it fails |
|---|---|
| `showDirectoryPicker()` (File System Access) | Broken in extension contexts on macOS. Rejects with *"the user aborted a request"* even when OK was pressed, and **crashes Chrome** in a side panel. crbug 40240444, still open on Chrome 141–150. |
| `chrome.downloads.download({filename})` | Only writes inside the Downloads folder; relative subpaths, no `..`. This is the old behaviour. |
| `chrome.fileSystem` | ChromeOS only. |

So the folder dialog and the disk write both live in this native process.

## How the pieces fit

```
page  ──► content script ──► service worker ──► chrome.runtime.sendNativeMessage
                                                        │  (4-byte LE length + JSON)
                                                        ▼
                                                  omni-native-host
                                                   ├─ osascript "choose folder"  → path
                                                   ├─ curl                       → file
                                                   └─ ffmpeg (+ probe)           → muxed file
```

**Media never crosses the bridge.** Chrome caps host→extension messages at
1 MB, which a single video exceeds. The host writes the file and returns
`{ok, path, bytes}`.

## The 5-minute wall (important)

Chrome terminates an extension service worker "when a single request… takes
longer than 5 minutes to process"[^lifecycle]. A download that takes longer than
that dies **silently, mid-transfer**.

The timeouts are therefore nested deliberately:

| Layer | Budget | Why |
|---|---|---|
| `curl --max-time` in the host | 210 s | gives up first, so the host can report a real error |
| `TRANSFER_TIMEOUT_MS` in the extension | 240 s | below Chrome's 5-minute kill |
| Chrome's service-worker limit | 300 s | the hard wall |

**A download slower than ~3.5 minutes still fails.** That is a real limitation,
and on a slow connection a large video can exceed it. The correct fix is
Chrome's documented escape hatch: `runtime.connectNative()` keeps the service
worker alive from Chrome 105 onward, because a long-lived port resets the idle
timer[^lifecycle]. That means changing the transport from the stateless
`sendNativeMessage` (one process per message) to a persistent port, which
requires request correlation on both sides. It is designed for but **not
implemented** here — the current code is safe (it fails cleanly rather than
hanging) but it will not carry a very large file over a slow link.

## Tests

```bash
cd native-host
cargo test --release        # 21 unit tests
node test-protocol.mjs      # 13 tests against the real binary over stdio
```

The protocol test is the one that matters for the process boundary: it speaks
Chrome's framing to the release binary, so an endianness or length-width bug
(which every unit test would miss) fails there.

`stream_detection_distinguishes_video_only_from_muxed` is the regression guard
for the bug this project shipped before: the old mp4box muxer produced a file
with no audio and recorded it as `completed`. The test generates a video-only
file and a real mux with ffmpeg and asserts the check rejects the first.

## Filename sanitisation is a security boundary

Filenames are assembled from author names and titles scraped out of page HTML,
so they are attacker-influenced. `sanitize_filename` reduces input to a single
path component: separators, `..`, control characters, NUL and macOS/Windows
reserved characters are removed, and the result is length-capped while keeping
its extension. Downloads are written to a `.part` file and renamed only on
success, so an interrupted transfer never leaves a truncated file that looks
finished.

[^lifecycle]: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
