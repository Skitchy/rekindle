import { join } from "node:path";
import { RekindleStorage } from "../storage/sqlite.js";
import { resolveStorageRoot } from "../storage/root.js";
import { OrientationService } from "../orientation/OrientationService.js";
import { OrientationRenderer } from "../orientation/OrientationRenderer.js";
import {
  budgetPacket,
  HOOK_BUDGET_BYTES,
  type PacketSection,
} from "./budget.js";
import { writeReceipt, type DeliveryReceipt } from "./receipts.js";

export interface HookInput {
  session_id?: string;
  source?: string;
  agent_type?: string;
  cwd?: string;
}

export interface SessionStartResult {
  /** Hook JSON to print to stdout, or null when nothing must be emitted. */
  stdout: string | null;
  receipt: DeliveryReceipt;
  receiptPath: string;
}

/**
 * Orientation sections in delivery-priority order: when the budget bites, the
 * later entries give way first. Identity is the anchor and goes down last.
 */
const SECTION_PRIORITY = [
  "identity",
  "checkpoint",
  "gaps",
  "score",
  "memories",
  "transcript",
] as const;

export function runSessionStart(
  input: HookInput,
  env: Record<string, string | undefined> = process.env
): SessionStartResult {
  const root = resolveStorageRoot({ env, cwd: input.cwd });
  const receiptPath =
    env.REKINDLE_RECEIPT_PATH ??
    join(root.baseDir, ".rekindle", "receipts", "session-start.jsonl");

  const excludedAgents = new Set(
    (env.REKINDLE_ORIENTATION_EXCLUDE_AGENTS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );

  let bypassReason: string | null = null;
  if (env.REKINDLE_ORIENTATION_BYPASS === "1") {
    bypassReason = "environment override";
  } else if (input.agent_type && excludedAgents.has(input.agent_type)) {
    bypassReason = `excluded agent type: ${input.agent_type}`;
  }

  const base: Omit<
    DeliveryReceipt,
    "emitted" | "emitted_bytes" | "sections" | "bypassed" | "bypass_reason" | "error"
  > = {
    schema_version: 2,
    channel: "session-start",
    client: env.REKINDLE_CLIENT ?? "claude-code",
    session_source: input.source ?? null,
    session_id: input.session_id ?? null,
    agent_type: input.agent_type ?? null,
    attempted_at: new Date().toISOString(),
    budget_bytes: HOOK_BUDGET_BYTES,
    model_visible: "unmeasured",
  };

  if (bypassReason !== null) {
    const receipt: DeliveryReceipt = {
      ...base,
      emitted: false,
      emitted_bytes: 0,
      sections: [],
      bypassed: true,
      bypass_reason: bypassReason,
      error: null,
    };
    return { stdout: null, receipt, receiptPath };
  }

  let sections: PacketSection[];
  try {
    const storage = new RekindleStorage(root.dbPath);
    try {
      const orientation = new OrientationService(storage);
      const result = orientation.generate({
        identityPath: join(root.baseDir, ".rekindle", "identity.md"),
        transcriptDir: join(root.baseDir, ".rekindle", "transcripts"),
        project: env.REKINDLE_PROJECT,
      });
      const byName = OrientationRenderer.toSections(result);
      sections = SECTION_PRIORITY.filter((name) => byName.has(name)).map(
        (name) => ({ name, content: byName.get(name) as string })
      );
    } finally {
      storage.close();
    }
  } catch (err) {
    const receipt: DeliveryReceipt = {
      ...base,
      emitted: false,
      emitted_bytes: 0,
      sections: [],
      bypassed: false,
      bypass_reason: null,
      error: err instanceof Error ? err.message : String(err),
    };
    return { stdout: null, receipt, receiptPath };
  }

  const packet = budgetPacket(sections);
  const receipt: DeliveryReceipt = {
    ...base,
    emitted: true,
    emitted_bytes: packet.bytes,
    sections: packet.sections,
    bypassed: false,
    bypass_reason: null,
    error: null,
  };
  const stdout = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: packet.text,
    },
  });
  return { stdout, receipt, receiptPath };
}

export async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");

  let input: HookInput = {};
  if (raw.trim()) {
    try {
      input = JSON.parse(raw) as HookInput;
    } catch {
      // Malformed stdin is not a reason to fail a session start; deliver with
      // an empty input record and let the receipt show what we knew.
    }
  }

  const { stdout, receipt, receiptPath } = runSessionStart(input);
  try {
    writeReceipt(receiptPath, receipt);
  } catch (err) {
    console.error(
      `rekindle session-start: could not write receipt at ${receiptPath}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  if (stdout !== null) process.stdout.write(stdout);
}
