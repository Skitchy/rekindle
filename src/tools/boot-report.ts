import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RekindleStorage } from "../storage/sqlite.js";
import { CaptureManager } from "../captures/index.js";
import { OrientationService, OrientationRenderer } from "../orientation/index.js";
import { withGuidance } from "../delivery/guidance.js";

export function registerBootReport(
  server: McpServer,
  storage: RekindleStorage,
  captureManager: CaptureManager
): void {
  const orientationService = new OrientationService(storage);

  server.tool(
    "boot_report",
    withGuidance(
      "boot_report",
      "Generate a session orientation report. Read-only — does not modify any stored data. Reads the identity document from disk, scans the memory database for statistics and the latest checkpoint, finds the most recent transcript file, detects structural gaps (missing identity, stale memories, no checkpoint, etc.), and calculates a 0-100 orientation score across 6 criteria. Also surfaces open loops from prior sessions and any PreCompact captures that preserve context from compacted sessions."
    ),
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
      let markdown = OrientationRenderer.toMarkdown(result);

      const openLoops = storage.list({ category: "context" })
        .filter((m) => m.type === "open_loop")
        .filter((m) => !project || m.project === project)
        .slice(0, 10);

      if (openLoops.length > 0) {
        markdown += "\n\n## Open Loops\n\n";
        for (const loop of openLoops) {
          markdown += `- ${loop.content}\n`;
        }
      }

      const allCaptures = captureManager.listCaptures();
      const projectCaptures = project
        ? allCaptures.filter((c) => c.project === project)
        : allCaptures;
      const recentCaptures = projectCaptures
        .sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime())
        .slice(0, 5);

      if (recentCaptures.length > 0) {
        markdown += "\n\n## PreCompact Captures\n\n";
        markdown += "Context from prior compaction events is available for recovery:\n\n";
        for (const cap of recentCaptures) {
          const reviewed = cap.reviewed_at ? " ✓ reviewed" : "";
          markdown += `- **${cap.id}** (${cap.captured_at}, ${cap.message_count} messages, ${cap.source}${reviewed})\n`;
        }
        markdown += "\nCall `list_captures` / `read_capture` to recover pre-compaction context.\n";
      }

      return {
        content: [{ type: "text" as const, text: markdown }],
      };
    }
  );
}
