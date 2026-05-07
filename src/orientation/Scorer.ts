import type { MemoryStats } from "../storage/sqlite.js";
import type { ScoreResult } from "./types.js";

export function calculateScore(
  hasIdentity: boolean,
  hasCheckpoint: boolean,
  hasTranscript: boolean,
  stats: MemoryStats,
  project?: string
): ScoreResult {
  const hasProjectMemories = project
    ? (stats.byProject[project] ?? 0) > 0
    : Object.keys(stats.byProject).some((k) => k !== "(none)");

  const breakdown = [
    {
      label: "Identity document loaded",
      points: 20,
      earned: hasIdentity,
    },
    {
      label: "Recent checkpoint exists",
      points: 20,
      earned: hasCheckpoint,
    },
    {
      label: "Session transcript found",
      points: 20,
      earned: hasTranscript,
    },
    {
      label: "Recent memories exist (last 7 days)",
      points: 20,
      earned: stats.recentCount > 0,
    },
    {
      label: "Relationship/preference memories populated",
      points: 10,
      earned:
        (stats.byCategory["relationship"] ?? 0) > 0 ||
        (stats.byCategory["preference"] ?? 0) > 0,
    },
    {
      label: project
        ? `Memories found for project "${project}"`
        : "Project-scoped memories found",
      points: 10,
      earned: hasProjectMemories,
    },
  ];

  const score = breakdown.reduce(
    (sum, item) => sum + (item.earned ? item.points : 0),
    0
  );

  return { score, breakdown };
}
