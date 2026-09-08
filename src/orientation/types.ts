import type { MemoryStats } from "../storage/sqlite.js";
import type { ProjectResolution } from "../config/project-resolution.js";
import type { TranscriptMode } from "../config/policy.js";

export interface OrientationConfig {
  identityPath: string;
  transcriptDir: string;
  project?: string;
  projectResolution?: ProjectResolution;
  transcriptMode?: TranscriptMode;
  allowCheckpointLookup?: boolean;
  allowContextFallback?: boolean;
}

export interface Gap {
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface ScoreItem {
  label: string;
  points: number;
  earned: boolean;
  applicable: boolean;
}

export interface ScoreResult {
  score: number;
  earnedPoints: number;
  possiblePoints: number;
  breakdown: ScoreItem[];
}

export interface OrientationResult {
  project?: ProjectResolution;
  identity: { loaded: boolean; path: string; content?: string };
  memoryStats: MemoryStats;
  checkpoint: { exists: boolean; id?: string; content?: string; created_at?: string };
  transcript: { exists: boolean; mode: TranscriptMode; name?: string; preview?: string };
  gaps: Gap[];
  score: number;
  scoreEarnedPoints: number;
  scorePossiblePoints: number;
  scoreBreakdown: ScoreItem[];
}
