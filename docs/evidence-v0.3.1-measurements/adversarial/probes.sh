#!/usr/bin/env bash
# Self-adversarial probe pass against the ratified v0.3.1 gate criteria.
# Each probe tries to BREAK the gate's claim using the built artifact (dist),
# not the source. PASS lines are grep-layer; raw outputs retained beside.
set -uo pipefail
R=<WORKSPACE>/rekindle
D="$R/dist"
B="$(cd "$(dirname "$0")" && pwd)"
cd "$B"
p() { printf '%s\n' "$*"; }

p "== P1 (gate 1): server at cwd=/ with NO env, HOME=fixture -> storage must land under HOME, never /"
FH=/private/tmp/rk-adv-p1; rm -rf "$FH"; mkdir -p "$FH"
OUT=$( (cd / && echo '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' | env HOME="$FH" timeout_ok=1 node "$D/index.js" 2>p1-stderr.log | head -c 300) )
echo "$OUT" > p1-init-reply.json
[ -n "$OUT" ] && grep -q '"result"' p1-init-reply.json && p "P1 handshake: PASS" || p "P1 handshake: FAIL"
find "$FH" -name "*.db" | grep -q . && p "P1 storage under fixture HOME: PASS" || p "P1 storage: FAIL (no db under fixture)"
ls /.rekindle 2>/dev/null && p "P1 ROOT POLLUTION: FAIL" || p "P1 no root pollution: PASS"

p "== P2 (gate 2): built server tools/list must carry all four Workflow fragments; instructions must carry nothing descriptions lack"
node - <<'JS' > p2-out.txt 2>&1
const { spawn } = require("child_process");
const fh = "/private/tmp/rk-adv-p2";
require("fs").mkdirSync(fh, { recursive: true });
const srv = spawn("node", ["<WORKSPACE>/rekindle/dist/index.js"], { env: { ...process.env, HOME: fh } });
let buf = "";
srv.stdout.on("data", d => { buf += d; });
const send = o => srv.stdin.write(JSON.stringify(o) + "\n");
send({jsonrpc:"2.0",id:0,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"p",version:"0"}}});
setTimeout(() => send({jsonrpc:"2.0",method:"notifications/initialized"}), 300);
setTimeout(() => send({jsonrpc:"2.0",id:1,method:"tools/list"}), 600);
setTimeout(() => {
  srv.kill();
  const lines = buf.trim().split("\n").map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const init = lines.find(l => l.id === 0), tl = lines.find(l => l.id === 1);
  const desc = (tl.result.tools || []).map(t => t.description || "").join("\n");
  const frags = [
    "call boot_report first thing every session",
    "call end_session at the end of every substantive session",
    "call list_captures then read_capture",
    "read recovered captures before relying on the latest checkpoint",
  ];
  for (const f of frags) console.log((desc.includes(f) ? "PASS" : "FAIL") + " fragment: " + f);
  const instr = (init.result && init.result.instructions) || "";
  const missing = instr.split(/\s+/).filter(w => w.length > 12 && !desc.includes(w));
  console.log(missing.length === 0 ? "PASS instructions subset of descriptions" : "FAIL instructions has content descriptions lack: " + missing.slice(0,5).join(","));
}, 1500);
JS
cat p2-out.txt

p "== P3 (gate 3): multibyte identity at the cut -> packet must be exactly <=8000 bytes AND valid UTF-8"
FH=/private/tmp/rk-adv-p3; rm -rf "$FH"; mkdir -p "$FH/.rekindle"
python3 -c "open('$FH/.rekindle/identity.md','w').write('X'+'é中\U0001F600'*3000)"
echo '{}' | env REKINDLE_BASE_DIR="$FH" REKINDLE_RECEIPT_PATH="$B/p3-receipts.jsonl" node "$D/init/cli.js" session-start > p3-stdout.json 2> p3-stderr.log
python3 - <<'PY'
import json
pkt = json.load(open("p3-stdout.json"))["hookSpecificOutput"]["additionalContext"]
b = pkt.encode("utf-8")
print("PASS bytes<=8000:" if len(b) <= 8000 else "FAIL bytes:", len(b))
try:
    b.decode("utf-8"); print("PASS valid utf-8 (no split code point)")
except Exception as e: print("FAIL utf-8:", e)
rec = json.loads(open("p3-receipts.jsonl").read().strip().split("\n")[-1])
print("PASS receipt bytes match" if rec["emitted_bytes"] == len(b) else f"FAIL receipt {rec['emitted_bytes']} != {len(b)}")
PY

p "== P5 (gate 5): Cursor adapter fed sentinel email + workspace path -> receipt (stdout+disk) must not contain either"
FH=/private/tmp/rk-adv-p5; rm -rf "$FH"; mkdir -p "$FH/.rekindle"
echo "# clean synthetic identity" > "$FH/.rekindle/identity.md"
printf '%s' '{"user_email":"probe-sentinel@example.com","workspace_roots":["/workspace-probe-sentinel/secret-project"],"conversation_id":"c1"}' | \
  env REKINDLE_BASE_DIR="$FH" REKINDLE_RECEIPT_PATH="$B/p5-receipts.jsonl" node "$D/init/cli.js" session-start --client cursor > p5-stdout.json 2> p5-stderr.log
if grep -qE "probe-sentinel@example.com|probe-sentinel-path" p5-receipts.jsonl p5-stdout.json 2>/dev/null; then p "P5 PRIVACY: FAIL (sentinel leaked)"; else p "P5 privacy invariant: PASS"; fi
grep -q '"additional_context"' p5-stdout.json && p "P5 cursor response shape: PASS" || p "P5 shape: FAIL"

p "== P6 (truth list): plain init must NOT write any hook config"
FH=/private/tmp/rk-adv-p6; rm -rf "$FH"; mkdir -p "$FH/proj"
(cd "$FH/proj" && env HOME="$FH" node "$D/init/cli.js" init >/dev/null 2>&1)
if grep -rq "PreCompact" "$FH/proj/.claude" "$FH/.claude" 2>/dev/null; then p "P6 FAIL: hook installed by plain init"; else p "P6 no auto-install: PASS"; fi
