import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CaptureManager } from "../captures/index.js";
import { withGuidance } from "../delivery/guidance.js";

export function registerListCaptures(
  server: McpServer,
  captureManager: CaptureManager
): void {
  server.tool(
    "list_captures",
    withGuidance(
      "list_captures",
      "List PreCompact captures for the current or recent sessions. PreCompact captures preserve context that would otherwise be lost during mid-session compaction."
    ),
    {
      session_id: z
        .string()
        .optional()
        .describe("Filter to a specific session. If omitted, returns all captures sorted by recency."),
    },
    async ({ session_id }) => {
      const captures = captureManager.listCaptures(session_id);

      if (captures.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                captures: [],
                message: "No PreCompact captures found.",
              }, null, 2),
            },
          ],
        };
      }

      const sorted = [...captures].sort(
        (a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
      );

      const output = sorted.map((c) => ({
        id: c.id,
        type: c.type,
        captured_at: c.captured_at,
        session_id: c.session_id,
        sequence: c.sequence,
        message_count: c.message_count,
        char_count: c.char_count,
        status: c.status,
        source: c.source,
        project: c.project,
      }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ captures: output }, null, 2),
          },
        ],
      };
    }
  );
}
