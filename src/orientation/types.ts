import type { MemoryStats } from "../storage/sqlite.js";

export interface OrientationConfig {
  identityPath: string;
  transcriptDir: string;
  project?: string;
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
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreItem[];
}

export interface OrientationResult {
  identity: { loaded: boolean; path: string; content?: string };
  memoryStats: MemoryStats;
  checkpoint: { exists: boolean; content?: string; created_at?: string };
  transcript: { exists: boolean; name?: string; preview?: string };
  gaps: Gap[];
  score: number;
  scoreBreakdown: ScoreItem[];
}
