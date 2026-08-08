// CC-H-07 variant harness: identical receipt logic, deliberately oversized packet.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const inputText = Buffer.concat(chunks).toString("utf-8");
const input = inputText.trim() ? JSON.parse(inputText) : {};
const runId = process.env.REKINDLE_SPIKE_RUN_ID ?? "missing-run-id";
const filler = "X".repeat(15000);
const packet = [`RK_IDENTITY_${runId}`, filler, `RK_OPEN_LOOP_${runId}`].join("\n");
const receipt = {
  schema_version: 1, run_id: runId, client: "claude-code",
  channel: "session-start", session_source: input.source ?? null,
  session_id: input.session_id ?? null,
  attempted_at: new Date().toISOString(),
  packet_bytes: Buffer.byteLength(packet, "utf-8"),
  delivered: true, bypassed: false, bypass_reason: null,
};
const receiptPath = process.env.REKINDLE_SPIKE_RECEIPT_PATH;
if (receiptPath) { mkdirSync(dirname(receiptPath), { recursive: true }); appendFileSync(receiptPath, JSON.stringify(receipt) + "\n", "utf-8"); }
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: packet } }));
