#!/usr/bin/env bash
# Gate 1 measurement — explicit Desktop-safe storage-root behavior.
# Oracle (O1 family, per ratified gate 1 / issue #6): Claude Desktop spawns the
# rekindle MCP server at cwd=/ with NO cwd wrapper; the gate-1 build must start,
# complete the MCP handshake, and place storage under the resolved home. The
# 7f09c85 build (pre-gate-1) is run once as a same-day contrast reproduction of
# the CD-M-01 crash; it is a disclosed reproduction, not a new matrix case.
# Safety: live config pre-hashed, mutated only by jq merge, restored and
# asserted byte-identical (execution control 4, per desktop-cases.sh precedent).
# Control 2: server env HOME points at a fixture; the real home and any real
# .rekindle are never a storage target.
set -uo pipefail

BASE="$(cd "$(dirname "$0")" && pwd)"
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
MCPLOG="$HOME/Library/Logs/Claude/mcp-server-rekindle.log"
FIX=/private/tmp/rk-gate1-desktop
GATE1_DIST="$BASE/../../rekindle/dist/index.js"          # gate-1 build (checked out branch)
BASELINE_DIST=/private/tmp/rk-cu-spike/build/dist/index.js  # 7f09c85, SHA-verified below
LOG="$BASE/capture-log.txt"

note() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }
fail() { note "ABORT: $1"; exit 1; }

launch_and_capture() {  # launch_and_capture <dir> <dist> <fixture-home>
  local dir=$1 dist=$2 fhome=$3
  mkdir -p "$dir" "$fhome"
  local offset=0
  [ -f "$MCPLOG" ] && offset=$(stat -f%z "$MCPLOG")
  jq --arg dist "$dist" --arg fhome "$fhome" \
    '.mcpServers = {rekindle: {command: "node", args: [$dist], env: {HOME: $fhome}}}' \
    "$BASE/BACKUP/config.pre.json" > "$CFG"
  cp "$CFG" "$dir/config-used.json"
  note "launch: dist=$(shasum -a 256 "$dist" | cut -c1-16) fixture_home=$fhome log_offset=$offset"
  open -a "Claude"
  sleep 35
  osascript -e 'tell application "Claude" to quit' >/dev/null 2>&1
  sleep 6
  pgrep -x "Claude" >/dev/null && { osascript -e 'tell application "Claude" to quit' >/dev/null 2>&1; sleep 5; }
  tail -c +$((offset+1)) "$MCPLOG" > "$dir/mcp-server-rekindle.slice.log" 2>/dev/null || true
  ( cd "$fhome" && find . -type f | sort > "$dir/fixture-home-tree.txt" )
  shasum -a 256 "$dist" > "$dir/dist.sha256"
}

case "${1:-}" in
  run)
    command -v jq >/dev/null || fail "jq missing"
    pgrep -x "Claude" >/dev/null && fail "Desktop is running; close it first"
    [ -f "$BASELINE_DIST" ] || fail "baseline build missing"
    echo "3ab52fec7bcdfa8e686790c418b6aa342195cdbefff0e90a5bd7c9681aef1e26  $BASELINE_DIST" \
      | shasum -a 256 -c - >/dev/null || fail "baseline SHA mismatch"
    rm -rf "$FIX"; mkdir -p "$BASE/BACKUP"
    cp "$CFG" "$BASE/BACKUP/config.pre.json"
    shasum -a 256 "$CFG" | cut -d' ' -f1 > "$BASE/BACKUP/pre.sha256"
    note "PRE-CAPTURE sha256=$(cat "$BASE/BACKUP/pre.sha256")"

    { echo "# Environment record (gate-1 Desktop measurement)"
      echo "date_utc: $(date -u +%FT%TZ)"
      echo "os: $(uname -sr) $(uname -m)"
      echo "desktop_app: $(defaults read /Applications/Claude.app/Contents/Info.plist CFBundleShortVersionString 2>/dev/null || echo unknown)"
      echo "gate1_build: branch gate1/desktop-safe-storage-root, dist sha256 $(shasum -a 256 "$GATE1_DIST" | cut -d' ' -f1)"
      echo "baseline_build: 7f09c85, dist sha256 3ab52fec... (contrast reproduction of CD-M-01 crash, one run)"
      echo "constraint: server env HOME set to per-attempt fixture; no cwd wrapper anywhere; real home never a storage target"
    } > "$BASE/ENVIRONMENT.txt"

    echo "== baseline contrast (7f09c85, expect crash before handshake)"
    launch_and_capture "$BASE/baseline-contrast" "$BASELINE_DIST" "$FIX/baseline/home"
    echo "== gate-1 attempt1"
    launch_and_capture "$BASE/attempt1" "$GATE1_DIST" "$FIX/attempt1/home"
    echo "== gate-1 attempt2"
    launch_and_capture "$BASE/attempt2" "$GATE1_DIST" "$FIX/attempt2/home"

    cp "$BASE/BACKUP/config.pre.json" "$CFG"
    POST=$(shasum -a 256 "$CFG" | cut -d' ' -f1)
    [ "$POST" = "$(cat "$BASE/BACKUP/pre.sha256")" ] \
      && note "RESTORE VERIFIED byte-identical sha256=$POST" \
      || fail "RESTORE MISMATCH"

    echo "== verdicts (grep layer; read the slices before believing me)"
    grep -lE "Server started and connected successfully|initialize" "$BASE"/attempt*/mcp-server-rekindle.slice.log 2>/dev/null || true
    for a in baseline-contrast attempt1 attempt2; do
      echo "--- $a: $(wc -c < "$BASE/$a/mcp-server-rekindle.slice.log" 2>/dev/null || echo 0) log bytes; fixture files: $(wc -l < "$BASE/$a/fixture-home-tree.txt" 2>/dev/null || echo 0)"
    done
    ;;
  *) echo "usage: gate1-desktop.sh run"; exit 1 ;;
esac
