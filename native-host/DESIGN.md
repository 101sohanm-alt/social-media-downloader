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

## Transfer duration and the service-worker lifetime

Native messaging is **exempt** from the service worker's five-minute cap. Chrome
states it plainly: *"Some APIs like native messaging provide a strong keep-alive
which cancel both of these timers"*[^lifetimes]. In the browser source,
`MessageService::OpenChannelToNativeAppImpl` sets
`should_have_strong_keepalive(true)` on the opener, which selects
`ServiceWorkerExternalRequestTimeoutType::kDoesNotTimeout`, i.e.
`TimeDelta::Max()` rather than the 5-minute default.

So a long download is not killed by Chrome's timer, and the extension does not
need to fit inside 300 s. The hosts's own `curl --max-time` is ours to choose;
it is set generously so real transfers complete.

Caveats worth knowing:
- The strong keep-alive is **documented for `connectNative`** and is only
  implementation behaviour for one-shot `sendNativeMessage`. Source-verified,
  not contractual.
- If Chrome *does* tear the worker down, it **SIGKILLs the host** — check
  `NativeMessageProcessHost::~NativeMessageProcessHost`, which calls
  `EnsureProcessTerminated`. That is why the host writes to `.part` and renames
  only on success: a killed host never leaves a file that looks finished.
- Our client-side deadline is therefore **our** deadline. When it elapses the
  host may still be writing, so the history row is recorded as `pending`, never
  `failed`. Reconciliation (`status` command / reading the job file) is the
  correct way to resolve it, and is the next step if this proves flaky.

An offscreen document cannot help here: native messaging is restricted to the
`privileged_extension` context in `_api_features.json`, so it is unavailable from
an offscreen document.[^lifecycle]

[^lifetimes]: https://developer.chrome.com/blog/longer-esw-lifetimes
[^lifecycle]: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle

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
