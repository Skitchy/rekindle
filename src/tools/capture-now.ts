import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CaptureManager } from "../captures/index.js";
import { discoverLatestTranscript } from "../captures/discover-transcript.js";
import type { HookInput } from "../captures/types.js";

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
      let resolvedSessionId = session_id;
      let resolvedTranscriptPath = transcript_path;

      if (!resolvedSessionId || !resolvedTranscriptPath) {
        const discovered = discoverLatestTranscript();
        if (!discovered) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: "Could not discover active session transcript. Provide session_id and transcript_path explicitly.",
                }, null, 2),
              },
            ],
          };
        }
        resolvedSessionId = resolvedSessionId ?? discovered.sessionId;
        resolvedTranscriptPath = resolvedTranscriptPath ?? discovered.transcriptPath;
      }

      const input: HookInput = {
        session_id: resolvedSessionId,
        transcript_path: resolvedTranscriptPath,
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
