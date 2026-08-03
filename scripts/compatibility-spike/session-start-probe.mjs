import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

const inputText = Buffer.concat(chunks).toString("utf-8");
const input = inputText.trim() ? JSON.parse(inputText) : {};
const runId = process.env.REKINDLE_SPIKE_RUN_ID ?? "missing-run-id";
const client = process.env.REKINDLE_SPIKE_CLIENT ?? "unknown";
const clientVersion = process.env.REKINDLE_SPIKE_CLIENT_VERSION ?? "unknown";
const receiptPath = process.env.REKINDLE_SPIKE_RECEIPT_PATH;
const excludedAgents = new Set(
  (process.env.REKINDLE_ORIENTATION_EXCLUDE_AGENTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

let bypassReason = null;
if (process.env.REKINDLE_ORIENTATION_BYPASS === "1") {
  bypassReason = "environment override";
} else if (input.agent_type && excludedAgents.has(input.agent_type)) {
  bypassReason = `excluded agent type: ${input.agent_type}`;
}

const packet = [
  `RK_IDENTITY_${runId}`,
  `RK_CONSTRAINT_${runId}`,
  `RK_OPEN_LOOP_${runId}`,
].join("\n");
const packetBytes = Buffer.byteLength(packet, "utf-8");

const receipt = {
  schema_version: 1,
  run_id: runId,
  client,
  client_version: clientVersion,
  channel: "session-start",
  session_source: input.source ?? null,
  session_id: input.session_id ?? null,
  agent_type: input.agent_type ?? null,
  attempted_at: new Date().toISOString(),
  packet_bytes: packetBytes,
  delivered: bypassReason === null,
  bypassed: bypassReason !== null,
  bypass_reason: bypassReason,
};

if (receiptPath) {
  mkdirSync(dirname(receiptPath), { recursive: true });
  appendFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, "utf-8");
}

if (!bypassReason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: packet,
      },
    })
  );
}
