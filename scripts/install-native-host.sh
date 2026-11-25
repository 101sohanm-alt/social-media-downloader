#!/usr/bin/env bash
#
# Install the Omni Media native messaging host for Chrome on macOS.
#
# Chrome launches a native process and talks JSON over stdin/stdout. The host is
# what makes an arbitrary destination folder possible: an MV3 extension cannot
# open a folder picker itself (showDirectoryPicker() is broken in extension
# contexts on macOS — crbug 40240444), so the folder dialog and the file writes
# both happen in the native process.
#
# Usage:
#   ./scripts/install-native-host.sh            # build, install, register
#   ./scripts/install-native-host.sh --print-id # show the pinned extension ID
#   ./scripts/install-native-host.sh --uninstall
#
set -euo pipefail

HOST_NAME="com.omni.media.downloader"
APP_SUPPORT="${HOME}/Library/Application Support/omni-media-downloader"
HOSTS_DIR="${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST="${HOSTS_DIR}/${HOST_NAME}.json"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_DIR="${REPO_ROOT}/native-host"
BIN="${APP_SUPPORT}/bin/omni-native-host"

say() { printf '  %s\n' "$*"; }
ok()  { printf '\033[32m✓\033[0m %s\n' "$*"; }
err() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; }
die() { err "$*"; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }

# ---------------------------------------------------------------------------
# The extension ID is derived from the extension's absolute path unless the
# manifest pins one with a "key". An unpacked extension that moves therefore
# changes ID, and Chrome then refuses to launch the host because allowed_origins
# no longer matches ("Specified native messaging host not found"). We compute the
# ID from the pinned key so the two can never drift.
# ---------------------------------------------------------------------------
extension_id() {
  local keyfile="${REPO_ROOT}/.extension-key"
  [[ -f "$keyfile" ]] || die "missing ${keyfile} — cannot determine a stable extension ID"

  # Chrome's ID is the first 128 bits of SHA-256 of the DER public key,
  # rendered as a-p (0-f mapped onto 'a'..'p').
  openssl rsa -in "$keyfile" -pubout -outform DER 2>/dev/null \
    | openssl dgst -sha256 -binary \
    | head -c 16 \
    | od -An -tx1 -v \
    | tr -d ' \n' \
    | tr '0-9a-f' 'a-p'
}

cmd_uninstall() {
  echo "Uninstalling ${HOST_NAME}…"
  rm -f "$MANIFEST"
  rm -rf "$APP_SUPPORT"
  ok "Removed host manifest and binary."
  say "Reload the extension card in chrome://extensions to pick up the change."
}

cmd_print_id() {
  extension_id
}

cmd_install() {
  need cargo; need openssl

  echo "Installing ${HOST_NAME}"

  # 1. Build -----------------------------------------------------------------
  [[ -d "$HOST_DIR" ]] || die "native-host/ directory not found at ${HOST_DIR}"
  echo "Building release binary…"
  ( cd "$HOST_DIR" && cargo build --release ) || die "cargo build failed"
  BUILT="${HOST_DIR}/target/release/omni-native-host"
  [[ -f "$BUILT" ]] || die "expected binary not found: ${BUILT}"
  ok "Built $(basename "$BUILT") ($(du -h "$BUILT" | cut -f1))"

  # 2. Copy into a stable location -------------------------------------------
  # Chrome stores the host path in the manifest, so the binary must not live in
  # a build directory that `cargo clean` or a worktree deletion would remove.
  mkdir -p "$(dirname "$BIN")"
  cp "$BUILT" "$BIN"
  chmod +x "$BIN"
  # Built locally, so it is not quarantined; strip the attribute anyway in case a
  # copy from a DMG or zip ever got in the way.
  xattr -d com.apple.quarantine "$BIN" 2>/dev/null || true
  ok "Installed binary to ${BIN}"

  # 3. Ad-hoc sign -----------------------------------------------------------
  # Apple silicon requires a signature; on Intel it is harmless. An unsigned
  # binary can be refused at launch, which surfaces only as a vague native
  # messaging error, so sign it either way.
  if command -v codesign >/dev/null 2>&1; then
    codesign --force --sign - "$BIN" 2>/dev/null && ok "Ad-hoc signed binary" \
      || say "codesign skipped (not fatal)"
  fi

  # 4. Register with Chrome --------------------------------------------------
  EXT_ID="$(extension_id)"
  [[ -n "$EXT_ID" ]] || die "failed to compute extension ID"

  mkdir -p "$HOSTS_DIR"
  cat > "$MANIFEST" <<JSON
{
  "name": "${HOST_NAME}",
  "description": "Omni Media downloader — native folder picker and disk writer",
  "path": "${BIN}",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://${EXT_ID}/"]
}
JSON
  ok "Wrote ${MANIFEST}"
  say "Allowed origin: chrome-extension://${EXT_ID}/"

  # 5. Smoke test the wire protocol -----------------------------------------
  # The protocol is a 4-byte little-endian length prefix followed by JSON, so the
  # prefix MUST be computed from the payload. Hardcoding it is how this check
  # first shipped: it said 22 bytes for a 14-byte message, the host waited for
  # the rest, and a perfectly good binary was reported as broken.
  #
  # printf emits the prefix via %b, because %s does not interpret escapes: the
  # escape sequence has to be built as text first, then expanded as bytes.
  echo "Smoke-testing the host…"
  local payload='{"cmd":"ping"}'
  local len=${#payload}
  local esc
  esc="$(printf '\\%03o' "$len")"

  local reply
  reply="$(printf '%b%s' "${esc}\\000\\000\\000" "$payload" | "$BIN" 2>/dev/null | tail -c +5)"

  if [[ "$reply" == *'"ok":true'* ]]; then
    ok "Host responds: ${reply}"
  else
    err "Host did not answer the ping correctly: ${reply:-<no output>}"
    say ""
    say "Diagnose with the binary directly (expect a JSON object):"
    say "  printf '%b%s' '${esc}\\000\\000\\000' '${payload}' | \"${BIN}\" | tail -c +5"
    say ""
    say "Common causes: the binary is not executable (chmod +x), or macOS"
    say "blocked it (xattr -d com.apple.quarantine \"${BIN}\")."
    exit 1
  fi

  # 6. Remind about the reload
  echo
  ok "Native host installed."
  say ""
  say "Next: open chrome://extensions and press Reload on the Omni Media card."
  say "Chrome caches the host manifest at startup, so if the folder button still"
  say "reports 'not connected', quit Chrome completely and reopen it."
}

case "${1:-}" in
  --print-id)  cmd_print_id ;;
  --uninstall) cmd_uninstall ;;
  "")          cmd_install ;;
  *)           die "unknown option: $1 (use --print-id, --uninstall, or no argument)" ;;
esac
