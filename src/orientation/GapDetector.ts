import type { MemoryStats } from "../storage/sqlite.js";
import type { Gap } from "./types.js";
import type { TranscriptMode } from "../config/policy.js";

export function detectGaps(
  stats: MemoryStats,
  hasIdentity: boolean,
  hasTranscript: boolean,
  hasCheckpoint: boolean,
  transcriptMode: TranscriptMode = "captured",
  identityFilled: boolean = hasIdentity
): Gap[] {
  const gaps: Gap[] = [];

  if (!hasIdentity) {
    gaps.push({
      code: "identity_missing",
      severity: "critical",
      message:
        "No identity document found. Run 'npx rekindle init' or create .rekindle/identity.md",
    });
  } else if (!identityFilled) {
    gaps.push({
      code: "identity_unfilled",
      severity: "warning",
      message:
        "The identity document is still the unfilled template. Fill in .rekindle/identity.md so the agent knows who it is.",
    });
  }

  if (stats.total === 0) {
    gaps.push({
      code: "memories_empty",
      severity: "warning",
      message: "No memories stored yet. Start storing memories during your session.",
    });
  }

  const expectedCategories = [
    "preference",
    "lesson",
    "context",
    "relationship",
  ] as const;
  for (const cat of expectedCategories) {
    if (!stats.byCategory[cat]) {
      gaps.push({
        code: `category_empty_${cat}`,
        severity: "info",
        message: `No ${cat} memories stored`,
      });
    }
  }

  if (stats.recentCount === 0 && stats.total > 0) {
    gaps.push({
      code: "recent_memory_stale",
      severity: "warning",
      message:
        "No memories stored in the last 7 days. Consider storing a session checkpoint.",
    });
  }

  if (!hasCheckpoint) {
    gaps.push({
      code: "checkpoint_missing",
      severity: "warning",
      message: "No checkpoint found. Use end_session to capture session state.",
    });
  }

  if (transcriptMode !== "excluded" && !hasTranscript) {
    gaps.push({
      code: "transcript_missing",
      severity: "info",
      message:
        "No session transcripts found. Configure the session capture hook for richer orientation.",
    });
  }

  return gaps;
}
