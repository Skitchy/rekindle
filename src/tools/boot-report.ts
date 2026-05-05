import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { RekindleStorage } from "../storage/sqlite.js";

function findLatestTranscript(
  transcriptDir: string
): { path: string; name: string; content: string } | null {
  if (!existsSync(transcriptDir)) return null;

  const files = readdirSync(transcriptDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  const filePath = join(transcriptDir, files[0]);
  const content = readFileSync(filePath, "utf-8");
  return { path: filePath, name: files[0], content };
}

function detectGaps(
  stats: ReturnType<RekindleStorage["stats"]>,
  hasIdentity: boolean,
  hasTranscript: boolean
): string[] {
  const gaps: string[] = [];

  if (!hasIdentity) {
    gaps.push(
      "No identity document found. Run 'npx rekindle init' or create .rekindle/identity.md"
    );
  }

  if (stats.total === 0) {
    gaps.push("No memories stored yet. Start storing memories during your session.");
  }

  const expectedCategories = [
    "preference",
    "lesson",
    "context",
    "relationship",
  ];
  for (const cat of expectedCategories) {
    if (!stats.byCategory[cat]) {
      gaps.push(`No ${cat} memories stored`);
    }
  }

  if (stats.recentCount === 0 && stats.total > 0) {
    gaps.push(
      "No memories stored in the last 7 days. Consider storing a session checkpoint."
    );
  }

  if (!hasTranscript) {
    gaps.push(
      "No session transcripts found. Configure the session capture hook for richer orientation."
    );
  }

  return gaps;
}

export function registerBootReport(
  server: McpServer,
  storage: RekindleStorage
): void {
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
    },
    async ({ identity_path, transcript_dir }) => {
      const sections: string[] = [];

      // Identity
      let hasIdentity = false;
      if (existsSync(identity_path)) {
        const identity = readFileSync(identity_path, "utf-8");
        hasIdentity = identity.trim().length > 0;
        sections.push(`## Identity\nLoaded from ${identity_path}\n\n${identity}`);
      } else {
        sections.push(`## Identity\nNot found at ${identity_path}`);
      }

      // Memory stats
      const stats = storage.stats();
      const catBreakdown = Object.entries(stats.byCategory)
        .map(([cat, count]) => `  ${cat}: ${count}`)
        .join("\n");
      const projBreakdown = Object.entries(stats.byProject)
        .map(([proj, count]) => `  ${proj}: ${count}`)
        .join("\n");

      sections.push(
        `## Memories\n${stats.total} total (${stats.recentCount} in last 7 days)\n\nBy category:\n${catBreakdown || "  (none)"}\n\nBy project:\n${projBreakdown || "  (none)"}`
      );

      // Latest checkpoint
      const checkpoint = storage.getLatestCheckpoint();
      if (checkpoint) {
        sections.push(
          `## Last Checkpoint\n${checkpoint.created_at}\n\n${checkpoint.content}`
        );
      } else {
        sections.push(`## Last Checkpoint\nNone found`);
      }

      // Latest transcript
      let hasTranscript = false;
      const transcript = findLatestTranscript(transcript_dir);
      if (transcript) {
        hasTranscript = true;
        const preview =
          transcript.content.length > 1500
            ? transcript.content.slice(0, 1500) + "\n\n[...truncated]"
            : transcript.content;
        sections.push(
          `## Last Session Transcript\n${transcript.name}\n\n${preview}`
        );
      } else {
        sections.push(
          `## Last Session Transcript\nNo transcripts found in ${transcript_dir}`
        );
      }

      // Gap detection
      const gaps = detectGaps(stats, hasIdentity, hasTranscript);
      if (gaps.length > 0) {
        sections.push(
          `## Gaps Detected\n${gaps.map((g) => `- ${g}`).join("\n")}`
        );
      } else {
        sections.push(`## Gaps Detected\nNone. Orientation looks complete.`);
      }

      const report = sections.join("\n\n---\n\n");

      return {
        content: [{ type: "text" as const, text: report }],
      };
    }
  );
}
