import { writeReceipt } from "./receipts.js";
import {
  runSessionStart,
  type HookInput,
  type SessionStartResult,
} from "./session-start.js";

/**
 * Cursor sessionStart adapter — gate 5.
 *
 * Contract measured in the CU spike (runs-2026-08-06-clean, CU-H-01):
 * - stdin payload carries conversation_id, generation_id, model,
 *   is_background_agent, session_id, hook_event_name, cursor_version,
 *   workspace_roots[], user_email, transcript_path.
 * - The hook's stdout response shape is top-level snake_case:
 *   {"additional_context": "..."} — NOT Claude Code's hookSpecificOutput.
 *
 * PRIVACY INVARIANT (Ari's requirement, ratified): Cursor hook stdin is
 * personal-context-bearing BY DEFAULT — user_email identifies the account
 * and workspace_roots / transcript_path are machine paths. This adapter
 * WHITELIST-extracts the fields it needs and never lets the raw payload,
 * the email, or any path reach a receipt or any other persisted artifact.
 * The raw stdin string dies with the process.
 */

/** The only fields the adapter reads. Everything else is never touched. */
interface CursorWhitelist {
  input: HookInput;
  isBackgroundAgent: boolean;
}

export function parseCursorHookInput(raw: string): CursorWhitelist {
  let payload: Record<string, unknown> = {};
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Malformed stdin is not a reason to fail a session start; deliver
      // with an empty input record and let the receipt show what we knew.
    }
  }

  const sessionId =
    typeof payload.session_id === "string" ? payload.session_id : undefined;
  const workspaceRoots = Array.isArray(payload.workspace_roots)
    ? payload.workspace_roots.filter((r): r is string => typeof r === "string")
    : [];

  return {
    input: {
      session_id: sessionId,
      source: "cursor-sessionStart",
      // workspace root is used ONLY for storage-root resolution (gate 1's
      // resolver); it is process-local and absent from the receipt schema.
      cwd: workspaceRoots[0],
    },
    isBackgroundAgent: payload.is_background_agent === true,
  };
}

/**
 * Background agents get a truthful bypass by default: an orientation packet
 * in a background context spends budget with no human present. Opt in with
 * REKINDLE_ORIENT_BACKGROUND_AGENTS=1.
 */
export function runCursorSessionStart(
  raw: string,
  env: Record<string, string | undefined> = process.env
): SessionStartResult {
  const { input, isBackgroundAgent } = parseCursorHookInput(raw);

  const cursorEnv: Record<string, string | undefined> = {
    ...env,
    REKINDLE_CLIENT: "cursor",
  };

  if (isBackgroundAgent && env.REKINDLE_ORIENT_BACKGROUND_AGENTS !== "1") {
    input.agent_type = "cursor-background-agent";
    const excluded = env.REKINDLE_ORIENTATION_EXCLUDE_AGENTS;
    cursorEnv.REKINDLE_ORIENTATION_EXCLUDE_AGENTS = excluded
      ? `${excluded},cursor-background-agent`
      : "cursor-background-agent";
  }

  const result = runSessionStart(input, cursorEnv);

  // Re-wrap the packet in Cursor's measured response shape.
  const stdout =
    result.packet !== null
      ? JSON.stringify({ additional_context: result.packet })
      : null;

  return { ...result, stdout };
}

export async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");

  const { stdout, receipt, receiptPath } = runCursorSessionStart(raw);
  try {
    writeReceipt(receiptPath, receipt);
  } catch (err) {
    console.error(
      `rekindle session-start --client cursor: could not write receipt at ${receiptPath}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  if (stdout !== null) process.stdout.write(stdout);
}
