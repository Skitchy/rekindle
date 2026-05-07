import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RekindleStorage } from "../storage/sqlite.js";
import { OrientationService, OrientationRenderer } from "../orientation/index.js";

export function registerBootReport(
  server: McpServer,
  storage: RekindleStorage
): void {
  const orientationService = new OrientationService(storage);

  server.tool(
    "boot_report",
    "Generate an orientation report for session start. Reads identity document, scans memories, finds latest transcript, and detects gaps in what was loaded. Call this first thing every session.",
    {
      identity_path: z
        .string()
        .describe("Path to identity.md (e.g., .rekindle/identity.md)"),
      transcript_dir: z
        .string()
        .describe(
          "Path to transcripts directory (e.g., .rekindle/transcripts)"
        ),
      project: z
        .string()
        .optional()
        .describe("Active project name for scoped orientation"),
    },
    async ({ identity_path, transcript_dir, project }) => {
      const result = orientationService.generate({
        identityPath: identity_path,
        transcriptDir: transcript_dir,
        project,
      });
      const markdown = OrientationRenderer.toMarkdown(result);

      return {
        content: [{ type: "text" as const, text: markdown }],
      };
    }
  );
}
