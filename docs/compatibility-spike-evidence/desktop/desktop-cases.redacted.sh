#!/usr/bin/env bash
# Compatibility spike — Claude Desktop cases (CD-H-01, CD-M-01, CD-M-02)
# per sealed matrix docs/compatibility-spike-matrix.md.
# Execution control 4 is implemented here: capture-before-launch,
# verify-after-teardown. The live config is backed up and hashed before any
# mutation; every mutation is a jq merge that preserves all user preferences;
# restore asserts byte-identical recovery against the pre-run hash.
set -uo pipefail

BASE="$(cd "$(dirname "$0")" && pwd)"
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
BACKUP_DIR="$BASE/CD-BACKUP"
LOG="$BASE/CD-capture-log.txt"
REKINDLE_DIST="<WORKSPACE>/rekindle/dist/index.js"

note() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }

case "${1:-}" in
  backup)
    mkdir -p "$BACKUP_DIR"
    cp "$CFG" "$BACKUP_DIR/claude_desktop_config.pre.json"
    PRE=$(shasum -a 256 "$CFG" | cut -d' ' -f1)
    echo "$PRE" > "$BACKUP_DIR/pre.sha256"
    note "PRE-CAPTURE sha256=$PRE backup=$BACKUP_DIR/claude_desktop_config.pre.json"
    ;;
  conf-hooks)
    attempt="${2:-1}"
    dir="$BASE/CD-H-01/attempt$attempt"; mkdir -p "$dir"
    jq --arg cmd "/bin/bash -c 'date -u +%FT%TZ >> \"$dir/hook-receipt.txt\"'" \
      '. + {hooks: {SessionStart: [{hooks: [{type: "command", command: $cmd, timeout: 30}]}]}}' \
      "$BACKUP_DIR/claude_desktop_config.pre.json" > "$CFG"
    cp "$CFG" "$dir/config-used.json"
    note "CD-H-01 attempt $attempt: hooks config written sha256=$(shasum -a 256 "$CFG" | cut -d' ' -f1)"
    ;;
  conf-mcp)
    jq --arg dist "$REKINDLE_DIST" \
      '.mcpServers = {rekindle: {command: "node", args: [$dist]}}' \
      "$BACKUP_DIR/claude_desktop_config.pre.json" > "$CFG"
    mkdir -p "$BASE/CD-M-01"
    cp "$CFG" "$BASE/CD-M-01/config-used.json"
    note "CD-M conf: rekindle mcpServer configured (dist sha256=$(shasum -a 256 "$REKINDLE_DIST" | cut -d' ' -f1)) config sha256=$(shasum -a 256 "$CFG" | cut -d' ' -f1)"
    ;;
  restore)
    cp "$BACKUP_DIR/claude_desktop_config.pre.json" "$CFG"
    PRE=$(cat "$BACKUP_DIR/pre.sha256")
    POST=$(shasum -a 256 "$CFG" | cut -d' ' -f1)
    if [ "$PRE" = "$POST" ]; then
      note "RESTORE VERIFIED byte-identical sha256=$POST"
    else
      note "RESTORE MISMATCH pre=$PRE post=$POST"; exit 1
    fi
    ;;
  status)
    echo "current: $(shasum -a 256 "$CFG" | cut -d' ' -f1)"
    [ -f "$BACKUP_DIR/pre.sha256" ] && echo "pre:     $(cat "$BACKUP_DIR/pre.sha256")"
    ;;
  *) echo "usage: desktop-cases.sh {backup|conf-hooks N|conf-mcp|restore|status}"; exit 1 ;;
esac
