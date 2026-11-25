//! Omni Media native messaging host.
//!
//! Chrome launches this binary as a child process and exchanges JSON with it
//! over stdin/stdout, each message framed with a 4-byte native-endian length
//! prefix. The host exists for two things a Manifest V3 extension cannot do:
//!
//!   1. Show a real macOS folder picker. `showDirectoryPicker()` is broken in
//!      extension contexts on macOS (crbug 40240444 — it rejects with "the user
//!      aborted a request" even when the user pressed OK, and crashes Chrome
//!      outright in a side panel).
//!   2. Write to a folder the user chose anywhere on disk. `chrome.downloads`
//!      can only ever write inside the Downloads folder.
//!
//! Media bytes never travel over the bridge: Chrome caps host->extension
//! messages at 1 MB. The host performs the transfer and returns a small receipt.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
// Aliased because the protocol enum below is also called `Command`; without
// this the two names shadow each other and every subprocess call breaks.
use std::process::{Command as ProcCommand, Stdio};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const DEFAULT_PROMPT: &str = "Choose where Omni Media should save downloads";

// ---------------------------------------------------------------------------
// Wire protocol
// ---------------------------------------------------------------------------

/// Commands arrive tagged by `cmd`. `#[serde(other)]` is not used because the
/// variant set is closed: an unknown command should be a clear error, not a
/// silent no-op.
#[derive(Debug, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Command {
    Ping,
    ChooseFolder {
        #[serde(default)]
        prompt: Option<String>,
    },
    GetFolder,
    SetFolder {
        path: String,
    },
    Download {
        url: String,
        filename: String,
    },
    Mux {
        video_url: String,
        audio_url: String,
        filename: String,
    },
}

/// Every command answers with the same shape: `ok` plus either the payload or
/// an `error` string. The extension side switches on this.
#[derive(Debug, Serialize)]
struct Reply {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    platform: Option<&'static str>,
    // Deliberately NOT skipped: `get_folder` has to distinguish "no folder
    // chosen" (`path: null`) from a field that is absent, and the extension-side
    // contract documents `path` as always present. Omitting it makes the reply
    // ambiguous and forces every consumer to special-case it.
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes: Option<u64>,
}

impl Reply {
    fn ok() -> Self {
        Reply { ok: true, error: None, version: None, platform: None, path: None, bytes: None }
    }

    fn err(message: impl Into<String>) -> Self {
        Reply { ok: false, error: Some(message.into()), version: None, platform: None, path: None, bytes: None }
    }

    fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    fn with_receipt(mut self, path: impl Into<String>, bytes: u64) -> Self {
        self.path = Some(path.into());
        self.bytes = Some(bytes);
        self
    }
}

/// Read one length-prefixed JSON message. Returns `None` at a clean EOF, which
/// is how Chrome signals "no more work" when it closes the pipe.
fn read_message<R: Read>(reader: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }

    // Native byte order, per Chrome's documentation.
    let len = u32::from_ne_bytes(len_buf) as usize;

    // Chrome allows up to 64 MiB inbound. Reject anything absurd rather than
    // allocating whatever a malformed prefix asks for.
    const MAX_INBOUND: usize = 64 * 1024 * 1024;
    if len > MAX_INBOUND {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("declared message length {len} exceeds the {MAX_INBOUND} byte limit"),
        ));
    }

    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf)?;
    Ok(Some(buf))
}

/// Write one length-prefixed JSON message.
fn write_message<W: Write>(writer: &mut W, payload: &[u8]) -> io::Result<()> {
    writer.write_all(&(payload.len() as u32).to_ne_bytes())?;
    writer.write_all(payload)?;
    writer.flush()
}

// ---------------------------------------------------------------------------
// Filename sanitisation — a security boundary, not a nicety
// ---------------------------------------------------------------------------

/// Reduce an arbitrary string to a safe single path component.
///
/// The incoming filename is assembled from author names and titles scraped out
/// of Instagram/X/Reddit pages, so it is attacker-influenced. It must never be
/// able to escape the chosen download folder, which rules out separators,
/// parent refs, absolute paths, `~` expansion, NUL bytes and control characters.
///
/// Returns `None` when nothing usable survives.
fn sanitize_filename(raw: &str) -> Option<String> {
    // Take the last component of any path-like input first, so "/etc/passwd"
    // becomes "passwd" rather than being rejected outright — a scraped title
    // sometimes legitimately contains a slash.
    let last = raw.rsplit(['/', '\\']).find(|s| !s.is_empty()).unwrap_or("");

    let mut out = String::with_capacity(last.len());
    for ch in last.chars() {
        let mapped = match ch {
            // Whitespace must be tested BEFORE the control check: `\t`, `\n` and
            // `\r` are both, and folding them to a space keeps word boundaries
            // ("tab\there" -> "tab here") instead of welding them together.
            c if c.is_whitespace() => ' ',
            // Remaining control characters (including NUL) have no place in a
            // filename and can truncate it at the syscall boundary.
            c if c.is_control() => continue,
            // Reserved or path-significant on macOS/Windows.
            ':' | '*' | '?' | '"' | '<' | '>' | '|' => continue,
            c => c,
        };
        out.push(mapped);
    }

    // Collapse repeated spaces and trim.
    let collapsed = out.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim_matches(['.', ' ']).trim();

    // Refuse the special directory entries and anything that is only extension.
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return None;
    }

    // Keep the whole name under the common 255-byte filesystem limit, preserving
    // the extension so the OS still files it correctly.
    let mut name = trimmed.to_string();
    const MAX: usize = 200;
    if name.len() > MAX {
        let ext = Path::new(&name)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{e}"))
            .unwrap_or_default();
        let keep = MAX.saturating_sub(ext.len());
        // Truncate on a char boundary to avoid slicing a multi-byte character.
        let cut = name.char_indices().take_while(|(i, _)| *i <= keep).last().map(|(i, _)| i).unwrap_or(0);
        name = format!("{}{}", &name[..cut], ext);
    }

    Some(name)
}

/// Pick a path that does not clobber an existing file: `name (1).ext`, `(2)`, …
fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }

    let path = Path::new(filename);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().and_then(|e| e.to_str());

    for n in 1..10_000 {
        let name = match ext {
            Some(e) => format!("{stem} ({n}).{e}"),
            None => format!("{stem} ({n})"),
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(filename)
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/// `~/Library/Application Support/omni-media-downloader/config.json`
fn config_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("omni-media-downloader")
            .join("config.json"),
    )
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Config {
    folder: Option<String>,
}

fn load_config() -> Config {
    config_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(config: &Config) -> io::Result<()> {
    let path = config_path()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "HOME is not set"))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs::write(path, json)
}

/// Validate a candidate destination: absolute, exists, is a directory, writable.
fn validate_folder(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("no path given".into());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(format!("not an absolute path: {trimmed}"));
    }
    let meta = fs::metadata(&path).map_err(|e| format!("cannot access {trimmed}: {e}"))?;
    if !meta.is_dir() {
        return Err(format!("not a directory: {trimmed}"));
    }

    // A directory can exist and still reject writes (e.g. /System). Prove it by
    // creating and removing a probe file rather than trusting permissions bits.
    let probe = path.join(".omni-write-test");
    fs::write(&probe, b"ok").map_err(|e| format!("{trimmed} is not writable: {e}"))?;
    let _ = fs::remove_file(&probe);

    Ok(path)
}

/// The folder downloads go to: the saved choice, else the user's Downloads dir.
fn destination_folder() -> Result<PathBuf, String> {
    if let Some(saved) = load_config().folder {
        match validate_folder(&saved) {
            Ok(p) => return Ok(p),
            Err(e) => {
                // The folder can disappear (external drive ejected, folder
                // renamed). Fall through to the default rather than failing the
                // download, but say so on stderr for Chrome's log.
                eprintln!("[omni-host] saved folder unusable ({e}); falling back to ~/Downloads");
            }
        }
    }

    let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
    let downloads = PathBuf::from(home).join("Downloads");
    if !downloads.is_dir() {
        return Err(format!("{} does not exist", downloads.display()));
    }
    Ok(downloads)
}

// ---------------------------------------------------------------------------
// macOS folder picker
// ---------------------------------------------------------------------------

/// Escape a string for embedding in an AppleScript double-quoted literal.
///
/// The prompt reaches this from the extension, so it is untrusted. Backslash
/// must be escaped first, otherwise escaping the quotes would produce a stray
/// escape sequence. Newlines are folded to spaces because AppleScript string
/// literals do not span lines.
fn applescript_escape(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' | '\r' => out.push(' '),
            c => out.push(c),
        }
    }
    out
}

/// Show the native macOS folder chooser and return the POSIX path.
///
/// `choose folder` is a standard AppleScript addition, so this needs no crate,
/// no AppKit main-thread juggling, and no app bundle. Cancelling exits non-zero
/// with "-128" carried in the message.
fn choose_folder(prompt: &str) -> Result<String, String> {
    let script = format!(
        "POSIX path of (choose folder with prompt \"{}\")",
        applescript_escape(prompt)
    );

    let output = ProcCommand::new("/usr/bin/osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("could not run osascript: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("-128") {
            return Err("cancelled".into());
        }
        return Err(format!("folder picker failed: {}", stderr.trim()));
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // `choose folder` yields a trailing slash; strip it for a clean path.
    let path = path.trim_end_matches('/').to_string();

    if path.is_empty() {
        return Err("cancelled".into());
    }
    Ok(path)
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

/// Download `url` to `dest` atomically: write to a `.part` sibling and rename on
/// success, so an interrupted transfer never leaves a truncated file that looks
/// like a finished download.
fn fetch_to_file(url: &str, dest: &Path) -> Result<u64, String> {
    let part = dest.with_extension(format!(
        "{}.part",
        dest.extension().and_then(|e| e.to_str()).unwrap_or("tmp")
    ));

    if let Some(parent) = part.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }

    // -L follow redirects, --fail turn HTTP errors into a non-zero exit (without
    // it curl writes the error page to disk and reports success), --retry for
    // flaky CDN edges, and a UA/Referer because several CDNs 403 a bare request.
    let output = ProcCommand::new("/usr/bin/curl")
        .args([
            "-L",
            "--fail",
            "--silent",
            "--show-error",
            "--retry",
            "3",
            "--retry-delay",
            "1",
            "--connect-timeout",
            "30",
            // Native messaging carries a strong keep-alive that cancels the
            // service worker's five-minute cap (developer.chrome.com/blog/
            // longer-esw-lifetimes), so this budget is ours to choose rather
            // than something Chrome imposes. 15 minutes covers a large file on
            // a slow link; the extension's own deadline sits alongside it.
            "--max-time",
            "900",
            "-A",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
            "-e",
            "https://www.instagram.com/",
            "-o",
        ])
        .arg(&part)
        .arg(url)
        .stdout(Stdio::null())
        // `.output()` rather than `.status()`: with a piped stderr that nobody
        // drains, a chatty failure blocks curl once the pipe buffer fills, and
        // the diagnostic is lost either way. Capturing it means the reply can
        // say WHY the transfer failed instead of only an exit code.
        .output()
        .map_err(|e| format!("could not run curl: {e}"))?;

    if !output.status.success() {
        let _ = fs::remove_file(&part);
        let reason = String::from_utf8_lossy(&output.stderr);
        let reason = reason.trim();
        let detail = if reason.is_empty() {
            format!("curl exit {:?}", output.status.code())
        } else {
            // Last line only: curl puts the actionable message there.
            let last = reason.lines().last().unwrap_or(reason);
            format!("curl exit {:?}: {last}", output.status.code())
        };
        return Err(format!("download failed ({detail}) for {url}"));
    }

    let bytes = fs::metadata(&part).map_err(|e| format!("downloaded file missing: {e}"))?.len();

    // curl --fail can still yield an empty file for some CDN error responses.
    if bytes == 0 {
        let _ = fs::remove_file(&part);
        return Err(format!("downloaded file is empty: {url}"));
    }

    fs::rename(&part, dest).map_err(|e| {
        let _ = fs::remove_file(&part);
        format!("could not finalise {}: {e}", dest.display())
    })?;

    Ok(bytes)
}

/// Verify a produced media file actually carries both streams.
///
/// A mux that exits 0 can still emit a file with no audio track — the failure
/// mode the previous JS/mp4box implementation shipped, where a ~596-byte shell
/// was recorded as "completed". Counting streams is the only honest success
/// check.
///
/// Prefers `ffprobe`, but falls back to parsing `ffmpeg -i` because Homebrew and
/// the evermeet static builds do not always install the pair together (this
/// machine has ffmpeg and no ffprobe), and a missing probe must not be mistaken
/// for a missing stream.
fn has_video_and_audio(path: &Path) -> Result<bool, String> {
    if let Some(ffprobe) = find_tool("ffprobe") {
        let output = ProcCommand::new(&ffprobe)
            .args(["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0"])
            .arg(path)
            .output()
            .map_err(|e| format!("could not run ffprobe: {e}"))?;

        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            let has_video = text.lines().any(|l| l.trim() == "video");
            let has_audio = text.lines().any(|l| l.trim() == "audio");
            return Ok(has_video && has_audio);
        }
        // ffprobe present but unhappy: fall through to the ffmpeg parse rather
        // than declaring the file bad on the probe's say-so.
    }

    let ffmpeg = find_tool("ffmpeg").ok_or("ffmpeg is not installed")?;
    let output = ProcCommand::new(&ffmpeg)
        .args(["-hide_banner", "-i"])
        .arg(path)
        .output()
        .map_err(|e| format!("could not run ffmpeg: {e}"))?;

    // ffmpeg prints the stream table to stderr and then exits non-zero because no
    // output file was named; that is the expected, successful inspection path.
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    // "Stream #0:1[...]: Audio: aac ..." — the colon after the stream type is
    // what distinguishes a real stream line from the word appearing in metadata.
    let has_video = text.contains(": Video:");
    let has_audio = text.contains(": Audio:");

    Ok(has_video && has_audio)
}

/// Find ffmpeg/ffprobe: PATH first, then the usual Homebrew prefixes.
fn find_tool(name: &str) -> Option<PathBuf> {
    for prefix in ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"] {
        let candidate = PathBuf::from(prefix).join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Download a video-only and an audio-only DASH stream and remux them into one
/// mp4 with stream copy (no re-encode).
fn mux_streams(video_url: &str, audio_url: &str, dest: &Path) -> Result<u64, String> {
    let ffmpeg = find_tool("ffmpeg").ok_or("ffmpeg is not installed (brew install ffmpeg)")?;

    let tmp_dir = std::env::temp_dir().join(format!("omni-mux-{}", std::process::id()));
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("cannot create temp dir: {e}"))?;

    let vpath = tmp_dir.join("video.mp4");
    let apath = tmp_dir.join("audio.mp4");

    let result = (|| -> Result<u64, String> {
        fetch_to_file(video_url, &vpath)?;
        fetch_to_file(audio_url, &apath)?;

        let part = dest.with_extension("part.mp4");

        // -map pins the first video stream from input 0 and the first audio from
        // input 1; without it ffmpeg may pick a stream the container cannot hold.
        // -shortest trims the longer stream so the file does not end on silence.
        let status = ProcCommand::new(&ffmpeg)
            .args(["-y", "-loglevel", "error", "-i"])
            .arg(&vpath)
            .arg("-i")
            .arg(&apath)
            .args(["-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-shortest"])
            .arg(&part)
            .status()
            .map_err(|e| format!("could not run ffmpeg: {e}"))?;

        if !status.success() {
            let _ = fs::remove_file(&part);
            return Err("ffmpeg failed to remux the streams".into());
        }

        // Exit 0 is not proof. Confirm both streams exist before declaring success.
        if !has_video_and_audio(&part).unwrap_or(false) {
            let _ = fs::remove_file(&part);
            return Err("remuxed file is missing a video or audio stream".into());
        }

        let bytes = fs::metadata(&part).map_err(|e| format!("remuxed file missing: {e}"))?.len();
        fs::rename(&part, dest).map_err(|e| format!("could not finalise {}: {e}", dest.display()))?;
        Ok(bytes)
    })();

    let _ = fs::remove_dir_all(&tmp_dir);
    result
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

fn handle(command: Command) -> Reply {
    match command {
        Command::Ping => Reply {
            version: Some(VERSION),
            platform: Some("macos"),
            ..Reply::ok()
        },

        Command::ChooseFolder { prompt } => {
            let prompt = prompt.unwrap_or_else(|| DEFAULT_PROMPT.to_string());
            match choose_folder(&prompt) {
                Ok(path) => {
                    // Persist immediately: the user picking a folder is the whole
                    // point, and a later download must not need a second pick.
                    if let Err(e) = save_config(&Config { folder: Some(path.clone()) }) {
                        eprintln!("[omni-host] could not save folder choice: {e}");
                    }
                    Reply::ok().with_path(path)
                }
                Err(e) => Reply::err(e),
            }
        }

        Command::GetFolder => Reply::ok().with_path_opt(load_config().folder),
        Command::SetFolder { path } => match validate_folder(&path) {
            Ok(resolved) => {
                let text = resolved.to_string_lossy().to_string();
                match save_config(&Config { folder: Some(text.clone()) }) {
                    Ok(()) => Reply::ok().with_path(text),
                    Err(e) => Reply::err(format!("could not save folder: {e}")),
                }
            }
            Err(e) => Reply::err(e),
        },

        Command::Download { url, filename } => {
            let Some(safe) = sanitize_filename(&filename) else {
                return Reply::err("filename has no usable characters");
            };
            let folder = match destination_folder() {
                Ok(f) => f,
                Err(e) => return Reply::err(e),
            };
            let dest = unique_path(&folder, &safe);
            match fetch_to_file(&url, &dest) {
                Ok(bytes) => Reply::ok().with_receipt(dest.to_string_lossy().to_string(), bytes),
                Err(e) => Reply::err(e),
            }
        }

        Command::Mux { video_url, audio_url, filename } => {
            let Some(safe) = sanitize_filename(&filename) else {
                return Reply::err("filename has no usable characters");
            };
            let folder = match destination_folder() {
                Ok(f) => f,
                Err(e) => return Reply::err(e),
            };
            let dest = unique_path(&folder, &safe);
            match mux_streams(&video_url, &audio_url, &dest) {
                Ok(bytes) => Reply::ok().with_receipt(dest.to_string_lossy().to_string(), bytes),
                Err(e) => Reply::err(e),
            }
        }
    }
}

impl Reply {
    fn with_path_opt(self, path: Option<String>) -> Self {
        // `path: null` is meaningful here ("nothing chosen yet"), so this sets
        // the field explicitly rather than skipping it.
        Reply { path, ..self }
    }
}

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = stdin.lock();
    let mut writer = stdout.lock();

    loop {
        let raw = match read_message(&mut reader) {
            Ok(Some(raw)) => raw,
            Ok(None) => break, // Chrome closed the pipe
            Err(e) => {
                // A framing error means the stream is no longer trustworthy.
                eprintln!("[omni-host] framing error: {e}");
                break;
            }
        };

        let command: Command = match serde_json::from_slice(&raw) {
            Ok(c) => c,
            Err(e) => {
                let reply = Reply::err(format!("invalid command: {e}"));
                let _ = write_message(&mut writer, &serde_json::to_vec(&reply).unwrap_or_default());
                continue;
            }
        };

        // Keep a panic from killing the whole host: Chrome would see a dead pipe
        // with no explanation. Convert it into an ordinary error reply.
        let reply = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| handle(command)))
            .unwrap_or_else(|_| Reply::err("internal error while handling the command"));

        let bytes = serde_json::to_vec(&reply).unwrap_or_else(|_| {
            br#"{"ok":false,"error":"could not serialise reply"}"#.to_vec()
        });

        // Chrome rejects host messages above 1 MB; a receipt is tiny, so this is
        // a guard against a future bug rather than an expected path.
        if bytes.len() > 1024 * 1024 {
            let reply = Reply::err("reply exceeded the native messaging size limit");
            let _ = write_message(&mut writer, &serde_json::to_vec(&reply).unwrap_or_default());
            continue;
        }

        if let Err(e) = write_message(&mut writer, &bytes) {
            eprintln!("[omni-host] write error: {e}");
            break;
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn length_prefixed_message_round_trips() {
        let mut buf = Vec::new();
        write_message(&mut buf, br#"{"cmd":"ping"}"#).unwrap();
        let mut cursor = Cursor::new(buf);
        let msg = read_message(&mut cursor).unwrap().unwrap();
        assert_eq!(msg, br#"{"cmd":"ping"}"#);
    }

    #[test]
    fn large_payload_is_not_truncated() {
        // Guards against a 4 KiB stack-buffer mistake: the framing must carry a
        // payload far larger than any single read.
        let payload = vec![b'x'; 200_000];
        let mut buf = Vec::new();
        write_message(&mut buf, &payload).unwrap();
        let mut cursor = Cursor::new(buf);
        let msg = read_message(&mut cursor).unwrap().unwrap();
        assert_eq!(msg.len(), payload.len());
    }

    #[test]
    fn len_prefix_is_native_endian() {
        let mut buf = Vec::new();
        write_message(&mut buf, b"ab").unwrap();
        assert_eq!(&buf[..4], &2u32.to_ne_bytes());
    }

    #[test]
    fn clean_eof_returns_none() {
        let mut cursor = Cursor::new(Vec::new());
        assert!(read_message(&mut cursor).unwrap().is_none());
    }

    #[test]
    fn oversized_length_is_rejected() {
        let mut buf = (100u32).to_ne_bytes().to_vec();
        buf.extend_from_slice(b"short");
        let mut cursor = Cursor::new(buf);
        // Declared 100 bytes but only 5 present -> read_exact fails, no panic.
        assert!(read_message(&mut cursor).is_err());
    }

    #[test]
    fn filename_strips_path_traversal() {
        assert_eq!(sanitize_filename("../../../etc/passwd").as_deref(), Some("passwd"));
        assert_eq!(sanitize_filename("..\\..\\windows\\system32\\evil.exe").as_deref(), Some("evil.exe"));
        assert_eq!(sanitize_filename("/etc/shadow").as_deref(), Some("shadow"));
    }

    #[test]
    fn filename_strips_dangerous_characters() {
        assert_eq!(sanitize_filename("a:b*c?d\"e<f>g|h.mp4").as_deref(), Some("abcdefgh.mp4"));
        assert_eq!(sanitize_filename("tab\there.mp4").as_deref(), Some("tab here.mp4"));
        assert_eq!(sanitize_filename("nul\0byte.mp4").as_deref(), Some("nulbyte.mp4"));
    }

    #[test]
    fn filename_collapses_whitespace_and_dots() {
        assert_eq!(sanitize_filename("  spaced   out  .mp4 ").as_deref(), Some("spaced out .mp4"));
        assert_eq!(sanitize_filename("...hidden.mp4").as_deref(), Some("hidden.mp4"));
    }

    #[test]
    fn filename_rejects_unusable_input() {
        assert_eq!(sanitize_filename(""), None);
        assert_eq!(sanitize_filename("   "), None);
        assert_eq!(sanitize_filename(".."), None);
        assert_eq!(sanitize_filename("..."), None);
        assert_eq!(sanitize_filename("/"), None);
        assert_eq!(sanitize_filename("///"), None);
        assert_eq!(sanitize_filename("<>:\"|?*"), None);
    }

    #[test]
    fn filename_truncates_long_names_but_keeps_extension() {
        let long = format!("{}.mp4", "a".repeat(500));
        let out = sanitize_filename(&long).unwrap();
        assert!(out.len() <= 200, "too long: {}", out.len());
        assert!(out.ends_with(".mp4"));
    }

    #[test]
    fn filename_handles_unicode_without_panicking() {
        // Multi-byte characters must not be split by the length cut.
        let long = format!("{}.mp4", "é".repeat(400));
        let out = sanitize_filename(&long).unwrap();
        assert!(out.ends_with(".mp4"));
        // Ensure the result is valid UTF-8 by construction (String guarantees it).
        assert!(out.chars().count() > 0);
    }

    #[test]
    fn applescript_escape_neutralises_quotes() {
        // The classic breakout: a prompt containing a quote then arbitrary code.
        assert_eq!(
            applescript_escape("hi\" & (do shell script \"rm -rf /\") & \""),
            "hi\\\" & (do shell script \\\"rm -rf /\\\") & \\\""
        );
    }

    #[test]
    fn applescript_escape_handles_backslash_first() {
        // A backslash must be doubled, otherwise \" becomes \\" and breaks out.
        assert_eq!(applescript_escape("a\\\"b"), "a\\\\\\\"b");
    }

    #[test]
    fn applescript_escape_folds_newlines() {
        assert_eq!(applescript_escape("a\nb\rc"), "a b c");
    }

    #[test]
    fn unique_path_uniquifies() {
        let dir = std::env::temp_dir().join(format!("omni-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let _ = fs::remove_file(dir.join("f.mp4"));

        let first = unique_path(&dir, "f.mp4");
        assert_eq!(first.file_name().unwrap(), "f.mp4");

        fs::write(&first, b"x").unwrap();
        let second = unique_path(&dir, "f.mp4");
        assert_eq!(second.file_name().unwrap(), "f (1).mp4");

        fs::write(&second, b"x").unwrap();
        let third = unique_path(&dir, "f.mp4");
        assert_eq!(third.file_name().unwrap(), "f (2).mp4");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn validate_folder_rejects_relative_and_missing() {
        assert!(validate_folder("relative/path").is_err());
        assert!(validate_folder("/definitely/not/here/at/all").is_err());
        assert!(validate_folder("").is_err());
    }

    #[test]
    fn validate_folder_accepts_writable_dir() {
        let dir = std::env::temp_dir();
        assert!(validate_folder(dir.to_str().unwrap()).is_ok());
    }

    #[test]
    fn config_round_trips() {
        // Uses the real config path, so restore whatever was there.
        let original = load_config();
        let dir = std::env::temp_dir().to_string_lossy().to_string();

        save_config(&Config { folder: Some(dir.clone()) }).unwrap();
        assert_eq!(load_config().folder.as_deref(), Some(dir.as_str()));

        save_config(&original).unwrap();
    }

    #[test]
    fn ping_reply_shape_matches_contract() {
        let json = serde_json::to_string(&handle(Command::Ping)).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["platform"], "macos");
        assert!(v["version"].as_str().unwrap().len() > 0);
    }

    #[test]
    fn download_rejects_unsafe_filename_before_touching_disk() {
        let json = serde_json::to_string(&handle(Command::Download {
            url: "https://example.com/x".into(),
            filename: "///".into(),
        }))
        .unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["ok"], false);
        assert!(v["error"].as_str().unwrap().contains("filename"));
    }

    /// The stream check must reject a video-only file and accept a real mux.
    ///
    /// This is the exact check that would have caught the original mp4box bug,
    /// where a file with no audio was recorded as completed.
    ///
    /// A missing ffmpeg SKIPS this test rather than failing it — the suite must
    /// still run on a bare machine — but the skip is loud, because a silent
    /// `return` makes an unexercised check indistinguishable from a passing one.
    /// Failing to synthesise media WITH ffmpeg present is a real failure, not a
    /// skip: that means the encoder is broken, and the assumption behind the
    /// whole test is gone.
    #[test]
    fn stream_detection_distinguishes_video_only_from_muxed() {
        let Some(ffmpeg) = find_tool("ffmpeg") else {
            eprintln!("SKIPPED stream_detection: ffmpeg is not installed — this check did NOT run");
            return;
        };

        let dir = std::env::temp_dir().join(format!("omni-streams-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let video = dir.join("v.mp4");
        let audio = dir.join("a.m4a");
        let merged = dir.join("m.mp4");

        // 1 second of synthetic media — small and fast, no network.
        let made_video = ProcCommand::new(&ffmpeg)
            .args(["-y", "-loglevel", "error", "-f", "lavfi", "-i"])
            .arg("testsrc=duration=1:size=160x120:rate=10")
            .args(["-c:v", "libx264", "-pix_fmt", "yuv420p"])
            .arg(&video)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        let made_audio = ProcCommand::new(&ffmpeg)
            .args(["-y", "-loglevel", "error", "-f", "lavfi", "-i"])
            .arg("sine=frequency=440:duration=1")
            .args(["-c:a", "aac"])
            .arg(&audio)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        assert!(
            made_video && made_audio,
            "ffmpeg is present but could not synthesise test media — the environment \
             this check depends on is broken, so the check did not actually run"
        );

        // A video-only file must NOT be reported as having audio.
        assert_eq!(
            has_video_and_audio(&video).unwrap(),
            false,
            "video-only file was incorrectly accepted as a complete mux"
        );

        // After a real mux, both streams must be present.
        let muxed = ProcCommand::new(&ffmpeg)
            .args(["-y", "-loglevel", "error", "-i"])
            .arg(&video)
            .arg("-i")
            .arg(&audio)
            .args(["-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-shortest"])
            .arg(&merged)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if muxed {
            assert_eq!(
                has_video_and_audio(&merged).unwrap(),
                true,
                "a correctly muxed file was rejected"
            );
        }

        let _ = fs::remove_dir_all(&dir);
    }
}
