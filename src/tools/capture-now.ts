import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CaptureManager } from "../captures/index.js";
import { discoverLatestTranscript } from "../captures/discover-transcript.js";
import type { HookInput } from "../captures/types.js";
import { basename } from "node:path";

type CaptureTarget =
  | { ok: true; sessionId: string; transcriptPath: string }
  | { ok: false; message: string };

/**
 * Decide which session and transcript to capture without ever pairing a
 * supplied value with someone else's. A supplied path names its own session
 * (the transcript file is <session_id>.jsonl), so discovery is skipped. A
 * supplied session id only accepts a discovered transcript of that same session.
 */
export function resolveCaptureTarget(
  sessionId: string | undefined,
  transcriptPath: string | undefined,
  discover: () => { sessionId: string; transcriptPath: string } | null
): CaptureTarget {
  // A blank value is treated as not supplied, so it can never become an empty id.
  const givenId = sessionId?.trim() ? sessionId.trim() : undefined;
  const givenPath = transcriptPath?.trim() ? transcriptPath : undefined;

  if (givenPath) {
    const inferred = basename(givenPath).replace(/\.jsonl$/, "").trim();
    const id = givenId ?? inferred;
    if (!id || id.startsWith(".")) {
      return {
        ok: false,
        message: "Could not tell the session id from transcript_path. Provide session_id as well.",
      };
    }
    return { ok: true, sessionId: id, transcriptPath: givenPath };
  }
  const discovered = discover();
  if (!discovered) {
    return {
      ok: false,
      message: "Could not discover active session transcript. Provide session_id and transcript_path explicitly.",
    };
  }
  if (givenId && discovered.sessionId !== givenId) {
    return {
      ok: false,
      message: `The newest transcript belongs to session ${discovered.sessionId}, not ${givenId}. Provide transcript_path for session ${givenId}.`,
    };
  }
  // Discovery is held to the same rule as a supplied path: no blank or hidden id.
  const discoveredId = discovered.sessionId.trim();
  if (!discoveredId || discoveredId.startsWith(".")) {
    return {
      ok: false,
      message: "The discovered transcript has no usable session id. Provide session_id and transcript_path explicitly.",
    };
  }
  return { ok: true, sessionId: discoveredId, transcriptPath: discovered.transcriptPath };
}

export function registerCaptureNow(
  server: McpServer,
  captureManager: CaptureManager
): void {
  server.tool(
    "capture_now",
    "Manually capture current session context to .rekindle/captures/. Use this when you want to preserve the current conversation state — before a complex operation, when context feels at risk, or when the user requests it. Produces the same artifact as the automatic PreCompact hook but triggered on demand. session_id and transcript_path are optional — if omitted, the most recent transcript is discovered automatically.",
    {
      session_id: z
        .string()
        .optional()
        .describe("Current session ID. If omitted, discovered from the most recent transcript file."),
      transcript_path: z
        .string()
        .optional()
        .describe("Path to the current session's JSONL transcript file. If omitted, the most recent transcript is discovered automatically."),
      reason: z
        .string()
        .optional()
        .describe("Why this capture is being made (stored in the structured snapshot)."),
    },
    async ({ session_id, transcript_path, reason }) => {
      const target = resolveCaptureTarget(session_id, transcript_path, discoverLatestTranscript);
      if (!target.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, message: target.message }, null, 2),
            },
          ],
        };
      }

      const input: HookInput = {
        session_id: target.sessionId,
        transcript_path: target.transcriptPath,
        cwd: process.cwd(),
        hook_event_name: "ManualCapture",
      };

      const entry = captureManager.capture(input, "model_requested", reason);

      if (!entry) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                message: "No exchanges found in transcript. Nothing to capture.",
              }, null, 2),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              capture_id: entry.id,
              message_count: entry.message_count,
              raw_path: entry.raw_path,
              message: `Captured ${entry.message_count} exchanges. Use read_capture to review.`,
            }, null, 2),
          },
        ],
      };
    }
  );
}
