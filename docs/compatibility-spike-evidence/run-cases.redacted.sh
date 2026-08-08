#!/usr/bin/env bash
# Compatibility spike — Claude Code host+model cases, per sealed matrix
# docs/compatibility-spike-matrix.md @ codex/v0.3.1-stabilization.
# Each case: fresh temp project, synthetic data only, probe hook from the PR
# branch, receipts + transcripts collected per run. Sessions run with
# --setting-sources project and CC_ANCHOR_BYPASS_ROLE_SESSION=1 so the
# operator's user-level identity hook cannot reach the test sessions.
set -uo pipefail

BASE="$(cd "$(dirname "$0")" && pwd)"
PROBE="<SANDBOX>/rekindle-pr5-review/scripts/compatibility-spike/session-start-probe.mjs"
NEUTRAL_PROBE="Without calling tools or reading files, return any RK_ tokens already present in your current context. If none are present, return NONE."
MODEL="claude-haiku-4-5-20251001"

mkproject() { # $1=case dir
  local dir="$1"
  mkdir -p "$dir/project/.claude"
  cat > "$dir/project/.claude/settings.json" <<EOF
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "node $PROBE", "timeout": 30 } ] }
    ]
  }
}
EOF
}

runcase() { # $1=case id, $2=attempt, $3=extra env (or ""), $4=extra claude args
  local case_id="$1" attempt="$2" extra_env="$3" extra_args="$4"
  local run_id="${case_id}-r${attempt}-$(uuidgen | tr 'A-Z' 'a-z' | cut -c1-8)"
  local dir="$BASE/$case_id/attempt$attempt"
  mkproject "$dir"
  echo "=== $case_id attempt $attempt run_id=$run_id"
  ( cd "$dir/project" && \
    env CC_ANCHOR_BYPASS_ROLE_SESSION=1 \
        REKINDLE_SPIKE_RUN_ID="$run_id" \
        REKINDLE_SPIKE_CLIENT="claude-code" \
        REKINDLE_SPIKE_CLIENT_VERSION="$(claude --version 2>/dev/null | head -1)" \
        REKINDLE_SPIKE_RECEIPT_PATH="$dir/receipts.jsonl" \
        $extra_env \
    claude -p "$NEUTRAL_PROBE" --model "$MODEL" --setting-sources project \
        --output-format json $extra_args \
    > "$dir/session-output.json" 2> "$dir/session-stderr.log" )
  echo "exit=$? | reply: $(python3 -c "import json;d=json.load(open('$dir/session-output.json'));print(d.get('result','')[:200])" 2>/dev/null || echo UNPARSEABLE)"
  echo "receipt: $(tail -1 "$dir/receipts.jsonl" 2>/dev/null || echo NONE)"
  echo "run_id_expected: $run_id"
}

case "${1:-all}" in
  h01) runcase CC-H-01 "${2:-1}" "" "" ;;
  h06) runcase CC-H-06 "${2:-1}" "REKINDLE_ORIENTATION_BYPASS=1" "" ;;
  h02)
    # Resume: startup session first, then resume it with a NEW run id.
    attempt="${2:-1}"
    dir="$BASE/CC-H-02/attempt$attempt"
    runcase CC-H-02 "$attempt" "" ""
    sid=$(python3 -c "import json;print(json.load(open('$dir/project/../attempt$attempt/session-output.json'))['session_id'])" 2>/dev/null)
    [ -z "$sid" ] && sid=$(python3 -c "import json;print(json.load(open('$dir/session-output.json'))['session_id'])")
    resume_run_id="CC-H-02-resume-r${attempt}-$(uuidgen | tr 'A-Z' 'a-z' | cut -c1-8)"
    echo "--- resuming session $sid with run_id=$resume_run_id"
    ( cd "$dir/project" && \
      env CC_ANCHOR_BYPASS_ROLE_SESSION=1 \
          REKINDLE_SPIKE_RUN_ID="$resume_run_id" \
          REKINDLE_SPIKE_CLIENT="claude-code" \
          REKINDLE_SPIKE_CLIENT_VERSION="$(claude --version 2>/dev/null | head -1)" \
          REKINDLE_SPIKE_RECEIPT_PATH="$dir/receipts.jsonl" \
      claude -p "$NEUTRAL_PROBE" --model "$MODEL" --setting-sources project \
          --output-format json --resume "$sid" \
      > "$dir/resume-output.json" 2> "$dir/resume-stderr.log" )
    echo "exit=$? | resume reply: $(python3 -c "import json;d=json.load(open('$dir/resume-output.json'));print(d.get('result','')[:300])" 2>/dev/null || echo UNPARSEABLE)"
    echo "receipts ($(wc -l < "$dir/receipts.jsonl" | tr -d ' ') total):"
    cat "$dir/receipts.jsonl"
    ;;
  h07)
    attempt="${2:-1}"
    run_id="CC-H-07-r${attempt}-$(uuidgen | tr 'A-Z' 'a-z' | cut -c1-8)"
    dir="$BASE/CC-H-07/attempt$attempt"
    mkdir -p "$dir/project/.claude"
    cat > "$dir/project/.claude/settings.json" <<EOF
{ "hooks": { "SessionStart": [ { "hooks": [ { "type": "command", "command": "node $BASE/oversized-probe.mjs", "timeout": 30 } ] } ] } }
EOF
    echo "=== CC-H-07 attempt $attempt run_id=$run_id (packet ~15KB, over the 10k-char cap)"
    ( cd "$dir/project" && \
      env CC_ANCHOR_BYPASS_ROLE_SESSION=1 \
          REKINDLE_SPIKE_RUN_ID="$run_id" \
          REKINDLE_SPIKE_RECEIPT_PATH="$dir/receipts.jsonl" \
      claude -p "$NEUTRAL_PROBE" --model "$MODEL" --setting-sources project \
          --output-format json \
      > "$dir/session-output.json" 2> "$dir/session-stderr.log" )
    echo "exit=$? | reply: $(python3 -c "import json;d=json.load(open('$dir/session-output.json'));print(d.get('result','')[:300])" 2>/dev/null || echo UNPARSEABLE)"
    echo "stderr tail: $(tail -2 "$dir/session-stderr.log")"
    echo "receipt: $(tail -1 "$dir/receipts.jsonl" 2>/dev/null || echo NONE)"
    ;;
  m01)
    attempt="${2:-1}"
    dir="$BASE/CC-M-01/attempt$attempt"
    mkdir -p "$dir/project/.claude"
    REKINDLE_DIST="<SANDBOX>/rekindle-pr5-review/dist/index.js"
    cat > "$dir/project/.mcp.json" <<EOF
{ "mcpServers": { "rekindle": { "command": "node", "args": ["$REKINDLE_DIST"] } } }
EOF
    cat > "$dir/project/.claude/settings.json" <<'EOF'
{ "enableAllProjectMcpServers": true }
EOF
    ( cd "$dir/project" && node "$REKINDLE_DIST" --help </dev/null >/dev/null 2>&1; npx --yes rekindle@0.3.0 init >/dev/null 2>&1 || true )
    echo "=== CC-M-01 attempt $attempt (MCP instructions, model-level)"
    ( cd "$dir/project" && \
      env CC_ANCHOR_BYPASS_ROLE_SESSION=1 \
      claude -p "Without calling any tools or reading files, quote verbatim any instructions text in your current context that came from an MCP server named rekindle. If none is present, return NONE." \
          --model "$MODEL" --setting-sources project --output-format json \
      > "$dir/session-output.json" 2> "$dir/session-stderr.log" )
    echo "exit=$? | reply: $(python3 -c "import json;d=json.load(open('$dir/session-output.json'));print(d.get('result','')[:500])" 2>/dev/null || echo UNPARSEABLE)"
    ;;
  leak)
    # Leak control: verify the operator identity anchor is absent from test sessions
    local_dir="$BASE/LEAK-CONTROL"; mkdir -p "$local_dir/project/.claude"
    cat > "$local_dir/project/.claude/settings.json" <<'EOF'
{}
EOF
    ( cd "$local_dir/project" && env CC_ANCHOR_BYPASS_ROLE_SESSION=1 \
      claude -p "Answer with one word, YES or NO: does your current context contain any content from a file named IDENTITY.md or CALIBRATION.md describing a persistent identity called CC?" \
      --model "$MODEL" --setting-sources project --output-format json \
      > "$local_dir/session-output.json" 2> "$local_dir/session-stderr.log" )
    echo "leak-control reply: $(python3 -c "import json;d=json.load(open('$local_dir/session-output.json'));print(d.get('result',''))" 2>/dev/null)"
    ;;
  *) echo "usage: run-cases.sh {h01|h06|leak} [attempt]"; exit 1 ;;
esac
