import { closeSync, readFileSync, readdirSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { homedir } from "node:os";
import type { RekindleStorage } from "../storage/sqlite.js";
import type { OrientationConfig, OrientationResult } from "./types.js";
import { detectGaps } from "./GapDetector.js";
import { calculateScore } from "./Scorer.js";
import { identityHasContent } from "./identity-content.js";

function findLatestTranscript(
  transcriptDir: string,
  tailOnly: boolean = false
): { path: string; name: string; content: string } | null {
  if (!existsSync(transcriptDir)) return null;

  const files = readdirSync(transcriptDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  const filePath = join(transcriptDir, files[0]);
  let content: string;
  if (tailOnly) {
    const size = statSync(filePath).size;
    const length = Math.min(size, 4096);
    const buffer = Buffer.alloc(length);
    const fd = openSync(filePath, "r");
    try {
      readSync(fd, buffer, 0, length, size - length);
    } finally {
      closeSync(fd);
    }
    let start = 0;
    while (start < buffer.length && (buffer[start] & 0b11000000) === 0b10000000) start++;
    content = buffer.subarray(start).toString("utf-8");
  } else {
    content = readFileSync(filePath, "utf-8");
  }
  return { path: filePath, name: files[0], content };
}

/**
 * The registry the hook actually read, shown without leaking an absolute path:
 * `~/.rekindle/projects.json` for a home-rooted store, `.rekindle/projects.json`
 * when the store sits in the workspace, and the generic relative form otherwise.
 */
export function displayRegistryPath(registryPath: string, cwd: string | null, home: string = homedir()): string {
  const under = (dir: string) => dir.length > 0 && registryPath.startsWith(dir.endsWith(sep) ? dir : dir + sep);
  if (under(home)) return "~/" + relative(home, registryPath).split(sep).join("/");
  if (cwd && under(cwd)) return relative(cwd, registryPath).split(sep).join("/");
  return ".rekindle/projects.json";
}

export class OrientationService {
  constructor(private storage: RekindleStorage) {}

  generate(config: OrientationConfig): OrientationResult {
    let identityLoaded = false;
    let identityFilled = false;
    let identityContent: string | undefined;

    if (existsSync(config.identityPath)) {
      const raw = readFileSync(config.identityPath, "utf-8");
      identityLoaded = raw.trim().length > 0;
      if (identityLoaded) identityContent = raw;
      // The text is still delivered either way; only the score and gaps need to
      // know whether it says anything beyond the shipped template (#31).
      identityFilled = identityLoaded && identityHasContent(raw);
    }

    const stats = config.scopeStatsToProject
      ? config.project
        ? this.storage.stats(config.project)
        : { total: 0, byCategory: {}, byProject: {}, recentCount: 0 }
      : this.storage.stats();
    const checkpoint = config.allowCheckpointLookup === false
      ? null
      : this.storage.getLatestCheckpoint(config.project, {
          fallbackToContext: config.allowContextFallback ?? true,
        });
    const transcriptMode = config.transcriptMode ?? "captured";
    const transcript = transcriptMode === "excluded"
      ? null
      : findLatestTranscript(config.transcriptDir, transcriptMode === "tail-read-only");
    const hasTranscript = transcript !== null;
    const hasCheckpoint = checkpoint !== null;

    const gaps = detectGaps(stats, identityLoaded, hasTranscript, hasCheckpoint, transcriptMode, identityFilled);
    if (config.projectResolution && config.projectResolution.status !== "resolved") {
      // Both remedies named, registry path kept relative: the packet must not leak
      // absolute paths, and the user needs to know which file to edit.
      const ambiguous = config.projectResolution.status === "ambiguous";
      const registry = displayRegistryPath(config.projectResolution.registry_path, config.projectResolution.cwd);
      gaps.push({
        code: ambiguous ? "project_ambiguous" : "project_unknown",
        severity: "warning",
        message: ambiguous
          ? `Active workspace matched more than one project; no checkpoint was loaded. Remove the overlapping entries in ${registry}, or set REKINDLE_PROJECT to the project name.`
          : `Active workspace did not resolve to a project; no checkpoint was loaded. Add this workspace to ${registry}, or set REKINDLE_PROJECT to the project name.`,
      });
    }
    const { score, earnedPoints, possiblePoints, breakdown } = calculateScore(
      identityFilled,
      hasCheckpoint,
      hasTranscript,
      stats,
      config.project,
      transcriptMode,
      !config.projectResolution || config.projectResolution.status === "resolved"
    );

    const preview =
      transcript && transcript.content.length > 1500
        ? transcriptMode === "tail-read-only"
          ? "[...earlier transcript omitted]\n\n" + transcript.content.slice(-1500)
          : transcript.content.slice(0, 1500) + "\n\n[...truncated]"
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
      ...(config.userCard && config.userCard.source !== "unset" ? { userCard: config.userCard } : {}),
    };
  }
}
