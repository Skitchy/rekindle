#!/usr/bin/env bash
# Gate 2 measurement — Desktop tool-description delivery (sentinel probe).
# Oracle (gate 2, issue #6, from CD-M-01): Desktop shows the model ONLY the
# tool listing (names + descriptions); the four WORKFLOW_GUIDANCE fragments
# composed into tool descriptions (src/delivery/guidance.ts @ 76dfa6f) must be
# model-visible in a real Desktop chat. Sentinels are the fragments' exact
# phrases; the probe asks the model to quote "Workflow:" description text.
# Safety: execution control 4 (config pre-hashed, jq merge only, restored and
# asserted byte-identical); control 2 (server env HOME -> fixture; real home
# never a storage target); gate-1 resolver in this build handles cwd=/.
set -uo pipefail

BASE="$(cd "$(dirname "$0")" && pwd)"
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
MCPLOG="$HOME/Library/Logs/Claude/mcp-server-rekindle.log"
FIX=/private/tmp/rk-gate2-desktop
DIST=<WORKSPACE>/rekindle/dist/index.js

note() { echo "$(date -u +%FT%TZ) $*" | tee -a "$BASE/capture-log.txt"; }
fail() { note "ABORT: $1"; exit 1; }

case "${1:-}" in
  setup)
    command -v jq >/dev/null || fail "jq missing"
    pgrep -x "Claude" >/dev/null && fail "Desktop is running; close it first"
    [ -f "$DIST" ] || fail "gate-2 dist missing"
    mkdir -p "$BASE/BACKUP" "$FIX/home"
    [ -f "$BASE/BACKUP/config.pre.json" ] && fail "backup already exists; run restore first"
    cp "$CFG" "$BASE/BACKUP/config.pre.json"
    shasum -a 256 "$CFG" | cut -d' ' -f1 > "$BASE/BACKUP/pre.sha256"
    note "PRE-CAPTURE sha256=$(cat "$BASE/BACKUP/pre.sha256")"
    : > "$MCPLOG" 2>/dev/null || true
    jq --arg dist "$DIST" --arg fhome "$FIX/home" \
      '.mcpServers = {rekindle: {command: "node", args: [$dist], env: {HOME: $fhome}}}' \
      "$BASE/BACKUP/config.pre.json" > "$CFG"
    cp "$CFG" "$BASE/config-used.json"
    { echo "# Environment record (gate-2 Desktop sentinel measurement)"
      echo "date_utc: $(date -u +%FT%TZ)"
      echo "os: $(uname -sr) $(uname -m)"
      echo "desktop_app: $(defaults read /Applications/Claude.app/Contents/Info.plist CFBundleShortVersionString 2>/dev/null || echo unknown)"
      echo "gate2_build: branch gate2/tool-description-delivery @ $(cd <WORKSPACE>/rekindle && git rev-parse --short HEAD), dist sha256 $(shasum -a 256 "$DIST" | cut -d' ' -f1)"
      echo "constraint: server env HOME=$FIX/home; probe driven in-app; config restore asserted byte-identical"
    } > "$BASE/ENVIRONMENT.txt"
    note "setup complete; launch Desktop and run the probe"
    ;;
  restore)
    [ -f "$BASE/BACKUP/config.pre.json" ] || fail "no backup to restore"
    pgrep -x "Claude" >/dev/null && { osascript -e 'tell application "Claude" to quit' >/dev/null 2>&1; sleep 5; }
    cp "$BASE/BACKUP/config.pre.json" "$CFG"
    POST=$(shasum -a 256 "$CFG" | cut -d' ' -f1)
    [ "$POST" = "$(cat "$BASE/BACKUP/pre.sha256")" ] \
      && note "RESTORE VERIFIED byte-identical sha256=$POST" \
      || fail "RESTORE MISMATCH"
    cp "$MCPLOG" "$BASE/mcp-server-rekindle.full.log" 2>/dev/null || true
    ;;
  *) echo "usage: gate2-desktop.sh setup|restore"; exit 1 ;;
esac
