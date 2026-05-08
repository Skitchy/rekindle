export interface CaptureEntry {
  id: string;
  session_id: string;
  sequence: number;
  type: "precompact_capture";
  source: "precompact_hook" | "manual" | "model_requested";
  captured_at: string;
  project: string | null;
  cwd: string | null;
  raw_path: string;
  json_path: string;
  message_count: number;
  char_count: number;
  status: "active" | "superseded" | "archived";
  reviewed_at?: string;
  reviewed_mode?: "summary" | "structured" | "raw";
}

export interface CaptureManifest {
  version: number;
  captures: CaptureEntry[];
}

export interface StructuredSnapshot {
  type: "precompact_capture";
  source: "precompact_hook" | "manual" | "model_requested";
  session_id: string;
  project: string | null;
  captured_at: string;
  sequence: number;
  reason: string;
  raw_path: string;
  extraction_method: "script_generated" | "model_generated" | "pending";
  confidence: "low" | "medium" | "high";
  raw_capture_available: boolean;
  requires_review: boolean;
  summary: string;
  decisions: string[];
  open_loops: string[];
  active_files: string[];
  warnings: string[];
  context_shifts: string;
}

export interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  permission_mode?: string;
  effort?: { level: string };
  agent_id?: string;
  agent_type?: string;
}

export interface TranscriptEntry {
  timestamp: string;
  role: "human" | "assistant";
  text: string;
}

export interface CaptureConfig {
  maxMessages: number;
  maxChars: number;
  capturesDir: string;
  humanName: string;
  aiName: string;
}

export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  maxMessages: 80,
  maxChars: 120_000,
  capturesDir: ".rekindle/captures",
  humanName: "Human",
  aiName: "Assistant",
};
