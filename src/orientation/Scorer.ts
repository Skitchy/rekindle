import type { MemoryStats } from "../storage/sqlite.js";
import type { ScoreResult } from "./types.js";
import type { TranscriptMode } from "../config/policy.js";

export function calculateScore(
  hasIdentity: boolean,
  hasCheckpoint: boolean,
  hasTranscript: boolean,
  stats: MemoryStats,
  project?: string,
  transcriptMode: TranscriptMode = "captured",
  projectResolved: boolean = true
): ScoreResult {
  const hasProjectMemories = !projectResolved ? false : project
    ? (stats.byProject[project] ?? 0) > 0
    : Object.keys(stats.byProject).some((k) => k !== "(none)");

  const breakdown = [
    {
      label: "Identity document loaded",
      points: 20,
      earned: hasIdentity,
      applicable: true,
    },
    {
      label: "Recent checkpoint exists",
      points: 20,
      earned: hasCheckpoint,
      applicable: true,
    },
    {
      label: "Session transcript found",
      points: 20,
      earned: hasTranscript,
      applicable: transcriptMode !== "excluded",
    },
    {
      label: "Recent memories exist (last 7 days)",
      points: 20,
      earned: stats.recentCount > 0,
      applicable: true,
    },
    {
      label: "Relationship/preference memories populated",
      points: 10,
      earned:
        (stats.byCategory["relationship"] ?? 0) > 0 ||
        (stats.byCategory["preference"] ?? 0) > 0,
      applicable: true,
    },
    {
      label: project
        ? `Memories found for project "${project}"`
        : projectResolved ? "Project-scoped memories found" : "Active project resolved",
      points: 10,
      earned: hasProjectMemories,
      applicable: true,
    },
  ];

  const earnedPoints = breakdown.reduce(
    (sum, item) => sum + (item.applicable && item.earned ? item.points : 0),
    0
  );
  const possiblePoints = breakdown.reduce(
    (sum, item) => sum + (item.applicable ? item.points : 0), 0
  );
  const score = possiblePoints === 0 ? 0 : Math.round((earnedPoints / possiblePoints) * 100);

  return { score, earnedPoints, possiblePoints, breakdown };
}
