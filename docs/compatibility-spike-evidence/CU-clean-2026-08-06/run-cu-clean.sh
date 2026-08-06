#!/bin/bash
# run-cu-clean.sh — clean-account rerun of the Cursor column (CU-H-01, CU-H-02,
# CU-M-01) against the sealed matrix oracles at rekindle 7f09c85.
#
# Purpose: supersede the 2026-08-06 morning runs, whose raw packet was withheld
# because hook stdin carried the maintainer's personal account email. This run
# uses a deliberately public account (maintainer ruling, in-session 2026-08-06)
# so the RAW packet is publishable and independently verifiable.
#
# Improvement over the morning procedure: every command executed for an attempt
# is logged to that attempt's commands.txt, so the invocation surface is itself
# an artifact instead of living only in a session transcript.
set -uo pipefail

SPIKE_DIR="$(cd "$(dirname "$0")" && pwd)"
CLEAN=/private/tmp/rk-cu-clean
OUT="$SPIKE_DIR/runs-2026-08-06-clean"
BUILD=/private/tmp/rk-cu-spike/build     # morning's build, reused: SHA-verified below

# Portable timeout: stock macOS ships no coreutils `timeout`; perl alarm is
# always present. (First run of this script failed on exactly that.)
with_timeout() { perl -e 'alarm shift @ARGV; exec @ARGV' "$@"; }
EXPECTED_SHA=3ab52fec7bcdfa8e686790c418b6aa342195cdbefff0e90a5bd7c9681aef1e26

# Fixed probe texts (matrix O2 neutral probe; CU-M-01 probe from the morning
# stream record, byte-identical).
NEUTRAL_PROBE='Without calling tools or reading files, return any `RK_` tokens already present in your current context. If none are present, return `NONE`.'
M01_PROBE='Without calling any tools or reading any files, quote verbatim any MCP server instructions text already present in your current context. If none is present, return NONE.'

fail() { echo "ABORT: $1"; exit 1; }

log_run() {  # log_run <commands.txt> <cmd...>
  local LOG=$1; shift
  printf '%s\n' "$*" >> "$LOG"
  "$@"
}

# ---- Preflight -------------------------------------------------------------
[ -f "$BUILD/dist/index.js" ] || fail "measured build missing at $BUILD"
ACTUAL_SHA=$(shasum -a 256 "$BUILD/dist/index.js" | awk '{print $1}')
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || fail "build SHA mismatch: $ACTUAL_SHA"

ACCOUNT=$(cursor-agent status 2>/dev/null | grep -o 'Logged in as .*' || true)
echo "$ACCOUNT" | grep -q "thetinkeringdev@gmail.com" || fail "wrong account: $ACCOUNT"

rm -rf "$CLEAN" "$OUT"
mkdir -p "$CLEAN" "$OUT"

{ echo "# Environment record (clean-account rerun)"
  echo "date_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "client: cursor-agent $(cursor-agent --version 2>/dev/null | head -1)"
  echo "account: $ACCOUNT  (deliberately public store-contact account, maintainer ruling)"
  echo "os: $(uname -sr) $(uname -m)"
  echo "rekindle_build: 7f09c85, dist/index.js sha256 $ACTUAL_SHA (morning build reused, hash-verified)"
  echo "fixtures: fresh temporary projects under $CLEAN, synthetic data only"
  echo "deviation: --trust on all agent runs, --approve-mcps on CU-M-01 runs. The clean account has no prior workspace-trust state (first run stalled at the interactive trust prompt); these documented non-interactive flags clear pre-session gates only and do not alter the measured delivery channels."
} > "$OUT/ENVIRONMENT.txt"

# ---- CU-H-01: sessionStart channel availability (O1), x2 -------------------
for n in 1 2; do
  D="$CLEAN/CU-H-01/attempt$n"; P="$D/project"; CMDS="$D/commands.txt"
  mkdir -p "$P/.cursor" "$P/hooks"
  RUNID=$(openssl rand -hex 4); echo "$RUNID" > "$D/runid.txt"
  cat > "$P/.cursor/hooks.json" <<EOF
{
  "version": 1,
  "hooks": {
    "sessionStart": [ { "command": "./hooks/session-init.sh" } ]
  }
}
EOF
  cat > "$P/hooks/session-init.sh" <<EOF
#!/bin/bash
cat > $D/hook-stdin.json
date +%s > $D/hook-fired.sentinel
echo "{\"additional_context\": \"RK_IDENTITY_$RUNID RK_CONSTRAINT_$RUNID RK_OPEN_LOOP_$RUNID\"}"
EOF
  chmod +x "$P/hooks/session-init.sh"
  shasum -a 256 "$P/.cursor/hooks.json" "$P/hooks/session-init.sh" > "$D/config-before.sha256"
  echo "== CU-H-01 attempt$n (runid $RUNID)"
  ( cd "$P" && log_run "$CMDS" with_timeout 120 cursor-agent --trust -p "$NEUTRAL_PROBE" \
      > "$D/session-stdout.txt" 2> "$D/session-stderr.log" )
  shasum -a 256 -c "$D/config-before.sha256" > "$D/config-after-check.txt" 2>&1
  grep -q "RK_IDENTITY_$RUNID" "$D/session-stdout.txt" \
    && grep -q "RK_CONSTRAINT_$RUNID" "$D/session-stdout.txt" \
    && grep -q "RK_OPEN_LOOP_$RUNID" "$D/session-stdout.txt" \
    && [ -f "$D/hook-fired.sentinel" ] \
    && echo "   PASS: hook fired, all 3 canaries model-visible" \
    || echo "   CHECK FAILED: see $D"
done

# ---- CU-H-02: bypass withholds, truthful receipt (O3), x2 ------------------
for n in 1 2; do
  D="$CLEAN/CU-H-02/attempt$n"; P="$D/project"; CMDS="$D/commands.txt"
  mkdir -p "$P/.cursor" "$P/hooks"
  RUNID="CU-H-02-clean-r$n-$(openssl rand -hex 3)"; echo "$RUNID" > "$D/runid.txt"
  cat > "$P/.cursor/hooks.json" <<EOF
{
  "version": 1,
  "hooks": {
    "sessionStart": [ { "command": "./hooks/cursor-shim.sh" } ]
  }
}
EOF
  cat > "$P/hooks/cursor-shim.sh" <<EOF
#!/bin/bash
# Cursor-channel shim: adapts the sealed session-start probe to Cursor's hook
# contract (JSON out, additional_context key). Probe logic untouched.
export REKINDLE_SPIKE_RUN_ID="$RUNID"
export REKINDLE_SPIKE_CLIENT="cursor"
export REKINDLE_SPIKE_CLIENT_VERSION="\$(cursor-agent --version 2>/dev/null | head -1)"
export REKINDLE_SPIKE_RECEIPT_PATH="$D/receipts.jsonl"
export REKINDLE_ORIENTATION_BYPASS=1
tee $D/hook-stdin.json | node $BUILD/scripts/compatibility-spike/session-start-probe.mjs > $D/probe-raw-out.json
if [ -s $D/probe-raw-out.json ]; then
  python3 -c "import json,sys; d=json.load(open('$D/probe-raw-out.json')); print(json.dumps({'additional_context': d['hookSpecificOutput']['additionalContext']}))"
fi
EOF
  chmod +x "$P/hooks/cursor-shim.sh"
  shasum -a 256 "$P/.cursor/hooks.json" "$P/hooks/cursor-shim.sh" \
    "$BUILD/scripts/compatibility-spike/session-start-probe.mjs" > "$D/config-before.sha256"
  echo "== CU-H-02 attempt$n (runid $RUNID)"
  ( cd "$P" && log_run "$CMDS" with_timeout 120 cursor-agent --trust -p "$NEUTRAL_PROBE" \
      > "$D/session-stdout.txt" 2> "$D/session-stderr.log" )
  shasum -a 256 -c "$D/config-before.sha256" > "$D/config-after-check.txt" 2>&1
  grep -q "NONE" "$D/session-stdout.txt" \
    && grep -q '"delivered": *false' "$D/receipts.jsonl" \
    && grep -q '"bypassed": *true' "$D/receipts.jsonl" \
    && echo "   PASS: probe NONE, receipt bypassed+undelivered" \
    || echo "   CHECK FAILED: see $D"
done

# ---- CU-M-01: MCP instructions, protocol + model layers (O1, O6) -----------
# Protocol layer: capture the initialize response directly.
D="$CLEAN/CU-M-01"; mkdir -p "$D/protocol-project"
( cd "$D/protocol-project" && \
  (echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cu-clean-probe","version":"0"}}}'; sleep 1) \
  | with_timeout 30 node "$BUILD/dist/index.js" \
  > "$D/initialize-response.json" 2> "$D/protocol-stderr.log" )
grep -q '"instructions"' "$D/initialize-response.json" \
  && echo "== CU-M-01 protocol layer: instructions present in initialize response" \
  || echo "== CU-M-01 protocol layer: CHECK FAILED"

for n in 1 2; do
  A="$CLEAN/CU-M-01/attempt$n"; P="$A/project"; CMDS="$A/commands.txt"
  mkdir -p "$P/.cursor"
  cat > "$P/.cursor/mcp.json" <<EOF
{ "mcpServers": { "rekindle": { "command": "node", "args": ["$BUILD/dist/index.js"] } } }
EOF
  shasum -a 256 "$P/.cursor/mcp.json" > "$A/config-before.sha256"
  echo "== CU-M-01 attempt$n"
  ( cd "$P" && log_run "$CMDS" with_timeout 120 cursor-agent --trust --approve-mcps -p "$M01_PROBE" \
      > "$A/session-stdout.txt" 2> "$A/session-stderr.log" )
  shasum -a 256 -c "$A/config-before.sha256" > "$A/config-after-check.txt" 2>&1
  grep -q "boot_report before substantive work" "$A/session-stdout.txt" \
    && echo "   PASS: instructions text quoted at model layer" \
    || echo "   CHECK FAILED: see $A"
done

# Tool-call absence, independently instrumented via stream-json.
A="$CLEAN/CU-M-01/attempt3-toolcheck"; P="$A/project"; CMDS="$A/commands.txt"
mkdir -p "$P/.cursor"
cat > "$P/.cursor/mcp.json" <<EOF
{ "mcpServers": { "rekindle": { "command": "node", "args": ["$BUILD/dist/index.js"] } } }
EOF
echo "== CU-M-01 toolcheck (stream-json)"
( cd "$P" && log_run "$CMDS" with_timeout 120 cursor-agent --trust --approve-mcps -p "$M01_PROBE" --output-format stream-json \
    > "$A/session-stream.jsonl" 2> "$A/session-stderr.log" )
python3 - "$A/session-stream.jsonl" <<'PYEOF'
import json, sys
tools = [json.loads(l) for l in open(sys.argv[1]) if l.strip() and '"tool' in l]
tool_events = [e for e in tools if 'tool' in str(e.get('type',''))]
print(f"   stream events with tool type: {len(tool_events)}" + ("  PASS: zero tool events" if not tool_events else "  CHECK FAILED"))
PYEOF

# ---- Package + gate --------------------------------------------------------
cp -R "$CLEAN/CU-H-01" "$CLEAN/CU-H-02" "$CLEAN/CU-M-01" "$OUT/"
cp "$0" "$OUT/run-cu-clean.sh"
echo "== Evidence gate over $OUT"
"$SPIKE_DIR/../rekindle/scripts/compatibility-spike/evidence-gate.sh" "$OUT"
GATE=$?
echo "== GATE EXIT: $GATE (0=clean)"
echo "== DONE. Evidence at $OUT"
