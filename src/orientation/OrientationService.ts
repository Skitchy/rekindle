import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { RekindleStorage } from "../storage/sqlite.js";
import type { OrientationConfig, OrientationResult } from "./types.js";
import { detectGaps } from "./GapDetector.js";
import { calculateScore } from "./Scorer.js";

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

export class OrientationService {
  constructor(private storage: RekindleStorage) {}

  generate(config: OrientationConfig): OrientationResult {
    let identityLoaded = false;
    let identityContent: string | undefined;

    if (existsSync(config.identityPath)) {
      const raw = readFileSync(config.identityPath, "utf-8");
      identityLoaded = raw.trim().length > 0;
      if (identityLoaded) identityContent = raw;
    }

    const stats = this.storage.stats();
    const checkpoint = config.allowCheckpointLookup === false
      ? null
      : this.storage.getLatestCheckpoint(config.project, {
          fallbackToContext: config.allowContextFallback ?? true,
        });
    const transcriptMode = config.transcriptMode ?? "captured";
    const transcript = transcriptMode === "excluded" ? null : findLatestTranscript(config.transcriptDir);
    const hasTranscript = transcript !== null;
    const hasCheckpoint = checkpoint !== null;

    const gaps = detectGaps(stats, identityLoaded, hasTranscript, hasCheckpoint, transcriptMode);
    if (config.projectResolution && config.projectResolution.status !== "resolved") {
      gaps.push({
        code: config.projectResolution.status === "ambiguous" ? "project_ambiguous" : "project_unknown",
        severity: "warning",
        message: "Active workspace did not resolve to one canonical project; no checkpoint or context fallback was loaded.",
      });
    }
    const { score, earnedPoints, possiblePoints, breakdown } = calculateScore(
      identityLoaded,
      hasCheckpoint,
      hasTranscript,
      stats,
      config.project,
      transcriptMode,
      !config.projectResolution || config.projectResolution.status === "resolved"
    );

    const preview =
      transcript && transcript.content.length > 1500
        ? transcript.content.slice(0, 1500) + "\n\n[...truncated]"
        : transcript?.content;

    return {
      project: config.projectResolution,
      identity: {
        loaded: identityLoaded,
        path: config.identityPath,
        content: identityContent,
      },
      memoryStats: stats,
      checkpoint: {
        exists: hasCheckpoint,
        id: checkpoint?.id,
        content: checkpoint?.content,
        created_at: checkpoint?.created_at,
      },
      transcript: {
        exists: hasTranscript,
        mode: transcriptMode,
        name: transcript?.name,
        preview,
      },
      gaps,
      score,
      scoreEarnedPoints: earnedPoints,
      scorePossiblePoints: possiblePoints,
      scoreBreakdown: breakdown,
    };
  }
}
