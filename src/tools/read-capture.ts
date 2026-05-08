import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CaptureManager } from "../captures/index.js";

export function registerReadCapture(
  server: McpServer,
  captureManager: CaptureManager
): void {
  server.tool(
    "read_capture",
    "Read a PreCompact capture by ID. Use this to recover context that was lost during mid-session compaction. Three modes control token cost: 'summary' (one paragraph, cheap), 'structured' (decisions/loops/warnings, moderate), 'raw' (full transcript excerpt, expensive — only when summary or structured is insufficient). Start with the lightest mode that answers your question.",
    {
      id: z
        .string()
        .describe("Capture ID from list_captures (e.g., 'precompact-abc123-001')"),
      mode: z
        .enum(["summary", "structured", "raw"])
        .default("structured")
        .describe("Reading mode. 'summary': one-paragraph overview. 'structured': decisions, open loops, warnings, context shifts. 'raw': full transcript excerpt."),
    },
    async ({ id, mode }) => {
      const result = captureManager.readCapture(id, mode);

      if (result === null) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Capture '${id}' not found or file missing.`,
                suggestion: "Call list_captures to see available captures.",
              }, null, 2),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: result,
          },
        ],
      };
    }
  );
}
