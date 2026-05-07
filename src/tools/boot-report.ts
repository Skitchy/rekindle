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
    "Generate a session orientation report. Read-only — does not modify any stored data. Reads the identity document from disk, scans the memory database for statistics and the latest checkpoint, finds the most recent transcript file, detects structural gaps (missing identity, stale memories, no checkpoint, etc.), and calculates a 0-100 orientation score across 6 criteria. Returns a markdown report with: identity contents, latest checkpoint, memory statistics by category and project, detected gaps with severity codes, transcript excerpt, and a scored breakdown. Call this first thing every session to establish context before doing any work.",
    {
      identity_path: z
        .string()
        .describe("Absolute or relative path to the identity document (e.g., '.rekindle/identity.md'). This file describes who the user is and how to work with them. If the file does not exist, a critical gap is reported."),
      transcript_dir: z
        .string()
        .describe(
          "Absolute or relative path to the transcripts directory (e.g., '.rekindle/transcripts'). The most recent .md file in this directory is read and included in the report. If the directory is empty or missing, an info-level gap is reported."
        ),
      project: z
        .string()
        .optional()
        .describe("Active project name for scoped orientation. When provided, the orientation score includes a project-specific criterion and memory statistics are filtered to this project."),
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
