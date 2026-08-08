#!/usr/bin/env bash
# Gate 3 measurement — O5 (budget behavior) on the LIVE Claude Code host.
# Instrument upgrade over the Aug 3 synthetic probe: the hook is the REAL
# gate-3 adapter (rekindle session-start, dist a50ad961, branch
# gate2/tool-description-delivery @ 3e8f85c which stacks gate 3).
# Oracle O5 (matrix): packets at or below 8,000 bytes arrive intact; a
# deliberately oversized source must be truncated with the in-packet marker
# and never silently externalized or falsely claimed fully delivered.
# Conditions, each run twice:
#   A: identity small enough that the whole packet fits the budget.
#      PASS = lead + tail canaries model-visible AND the model can quote the
#      emitted packet's final line verbatim; receipt emitted=true,
#      emitted_bytes <= 8000, model_visible = "unmeasured".
#   B: 20KB identity, over budget. PASS = lead canary + truncation marker
#      model-visible, beyond-the-cut tail canary ABSENT from model context,
#      emitted_bytes == 8000 exactly, stderr shows no externalization.
# Controls: CC_ANCHOR_BYPASS_ROLE_SESSION=1 + --setting-sources project
# (operator identity anchor cannot reach test sessions); synthetic fixture
# content only; leak-control case per the Aug 2 rule.
set -uo pipefail

BASE="$(cd "$(dirname "$0")" && pwd)"
DIST=<WORKSPACE>/rekindle/dist/init/cli.js
FIX=/private/tmp/rk-gate3-o5
MODEL="claude-haiku-4-5-20251001"
PROBE='Without calling any tools or reading any files: (1) list every token in your current context that starts with RK_ , exactly as written; (2) if any rekindle orientation content is present in your context, quote its final line verbatim on a line beginning FINAL: ; (3) if a line mentioning rekindle and a hook output budget is present, quote it verbatim on a line beginning MARKER: ; (4) quote verbatim, on a line beginning TLINE: , any line in your context containing the phrase transcript directory . If none of these exist, return NONE.'

note() { echo "$(date -u +%FT%TZ) $*" | tee -a "$BASE/capture-log.txt"; }

mkidentity_a() { # $1=path $2=runtag  — small identity, packet fits budget
  {
    echo "# Synthetic Orientation Identity (gate-3 O5 fixture, condition A)"
    echo "RK_O5_LEAD_$2"
    for i in $(seq 1 12); do
      echo "Synthetic continuity line $i: this text exists only to give the packet realistic bulk. No real project or person is described here."
    done
    echo "RK_O5_TAIL_$2"
  } > "$1"
}

mkidentity_b() { # $1=path $2=runtag  — ~20KB identity, forces truncation
  {
    echo "# Synthetic Orientation Identity (gate-3 O5 fixture, condition B)"
    echo "RK_O5_LEAD_$2"
    for i in $(seq 1 220); do
      echo "Padding line $i: eighty-odd bytes of synthetic filler so the identity overflows the eight-kilobyte hook budget."
    done
    echo "RK_O5_TAIL_$2"
  } > "$1"
}

runcase() { # $1=condition (a|b), $2=attempt
  local cond="$1" attempt="$2"
  local tag="$(uuidgen | tr 'A-Z' 'a-z' | cut -c1-8)"
  local dir="$BASE/condition-$cond/attempt$attempt"
  local home="$FIX/$cond-$attempt"
  rm -rf "$home"; mkdir -p "$dir" "$home/.rekindle" "$dir/project/.claude"

  if [ "$cond" = a ]; then mkidentity_a "$home/.rekindle/identity.md" "$tag"
  else mkidentity_b "$home/.rekindle/identity.md" "$tag"; fi

  cat > "$dir/project/.claude/settings.json" <<EOF
{ "hooks": { "SessionStart": [ { "hooks": [ { "type": "command", "command": "node $DIST session-start", "timeout": 30 } ] } ] } }
EOF

  # Dry-run the adapter standalone first: capture the exact emitted packet.
  echo '{"session_id":"dryrun","source":"startup"}' | \
    env REKINDLE_BASE_DIR="$home" REKINDLE_RECEIPT_PATH="$dir/receipts.jsonl" \
    node "$DIST" session-start > "$dir/dryrun-stdout.json" 2> "$dir/dryrun-stderr.log"
  python3 - "$dir" <<'PY'
import json, sys, os
d = sys.argv[1]
raw = open(os.path.join(d, "dryrun-stdout.json")).read()
packet = json.loads(raw)["hookSpecificOutput"]["additionalContext"] if raw.strip() else ""
open(os.path.join(d, "packet-emitted.txt"), "w").write(packet)
lines = [l for l in packet.splitlines() if l.strip()]
open(os.path.join(d, "packet-final-line.txt"), "w").write(lines[-1] if lines else "")
print(f"emitted packet: {len(packet.encode('utf-8'))} bytes, final line: {lines[-1][:80] if lines else 'EMPTY'}")
PY

  # Live host run.
  note "$cond attempt$attempt tag=$tag live run"
  ( cd "$dir/project" && \
    env CC_ANCHOR_BYPASS_ROLE_SESSION=1 \
        REKINDLE_BASE_DIR="$home" \
        REKINDLE_RECEIPT_PATH="$dir/receipts.jsonl" \
    claude -p "$PROBE" --model "$MODEL" --setting-sources project \
        --strict-mcp-config --output-format json \
    > "$dir/session-output.json" 2> "$dir/session-stderr.log" )
  echo "exit=$?"
  echo "$tag" > "$dir/runtag.txt"
  python3 - "$dir" "$tag" "$cond" <<'PY'
import json, sys, os
d, tag, cond = sys.argv[1], sys.argv[2], sys.argv[3]
reply = json.load(open(os.path.join(d, "session-output.json"))).get("result", "")
open(os.path.join(d, "model-reply.txt"), "w").write(reply)
lead, tail = f"RK_O5_LEAD_{tag}" in reply, f"RK_O5_TAIL_{tag}" in reply
marker = "truncated to fit the hook output budget" in reply
final = open(os.path.join(d, "packet-final-line.txt")).read().strip()
final_ok = bool(final) and final in reply
receipts = [json.loads(l) for l in open(os.path.join(d, "receipts.jsonl"))]
live = receipts[-1]
print(f"lead={lead} tail={tail} marker={marker} final_line_quoted={final_ok}")
print(f"receipt: emitted={live['emitted']} bytes={live['emitted_bytes']} model_visible={live['model_visible']} error={live['error']}")
if cond == "a":
    verdict = lead and tail and final_ok and live["emitted"] and live["emitted_bytes"] <= 8000
else:
    verdict = lead and (not tail) and marker and live["emitted_bytes"] == 8000
print(f"GREP-LAYER VERDICT ({cond}): {'PASS' if verdict else 'FAIL'} -- read model-reply.txt before believing me")
PY
}

case "${1:-}" in
  run)
    command -v claude >/dev/null || { echo "claude missing"; exit 1; }
    { echo "# Environment record (gate-3 O5 live-host measurement)"
      echo "date_utc: $(date -u +%FT%TZ)"
      echo "os: $(uname -sr) $(uname -m)"
      echo "claude_code: $(claude --version 2>/dev/null | head -1)"
      echo "model: $MODEL"
      echo "adapter_dist_sha256: $(shasum -a 256 "$DIST" | cut -d' ' -f1)"
      echo "branch: gate2/tool-description-delivery @ $(cd <WORKSPACE>/rekindle && git rev-parse --short HEAD)"
      echo "controls: CC_ANCHOR_BYPASS_ROLE_SESSION=1, --setting-sources project, synthetic fixture identity, fixture base under $FIX"
    } > "$BASE/ENVIRONMENT.txt"
    runcase a 1; runcase a 2; runcase b 1; runcase b 2
    # Leak control: operator anchor must be absent from test sessions.
    mkdir -p "$BASE/LEAK-CONTROL/project/.claude"
    echo '{}' > "$BASE/LEAK-CONTROL/project/.claude/settings.json"
    ( cd "$BASE/LEAK-CONTROL/project" && env CC_ANCHOR_BYPASS_ROLE_SESSION=1 \
      claude -p "Answer with one word, YES or NO: does your current context contain any content from a file named IDENTITY.md or CALIBRATION.md describing a persistent identity called CC?" \
      --model "$MODEL" --setting-sources project --strict-mcp-config --output-format json \
      > "$BASE/LEAK-CONTROL/session-output.json" 2> "$BASE/LEAK-CONTROL/session-stderr.log" )
    echo "leak-control reply: $(python3 -c "import json;print(json.load(open('$BASE/LEAK-CONTROL/session-output.json')).get('result',''))" 2>/dev/null)"
    ;;
  a3)
    # Third attempt of condition A: attempt 2's model reply paraphrased the
    # packet's final line (inserted "session", plausibly from the adjacent
    # heading); canaries were exact. Strict oracle wants exact quotes twice.
    runcase a 3
    ;;
  *) echo "usage: gate3-o5.sh run|a3"; exit 1 ;;
esac
