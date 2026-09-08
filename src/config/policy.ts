import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type TranscriptMode = "excluded" | "tail-read-only" | "captured";

export interface ContinuityPolicy {
  schema_version: 1;
  transcript_mode: TranscriptMode;
  startup_budget_bytes: number;
  mandatory_sections: string[];
  optional_sections: string[];
  background_writes_allowed: boolean;
}

export interface LoadedPolicy {
  policy: ContinuityPolicy;
  path: string;
  source: "default" | "file";
  hash: string;
}

export const DEFAULT_POLICY: ContinuityPolicy = {
  schema_version: 1,
  transcript_mode: "captured",
  startup_budget_bytes: 8000,
  mandatory_sections: ["identity", "project", "checkpoint", "policy"],
  optional_sections: ["gaps", "score", "memories", "transcript"],
  background_writes_allowed: false,
};

const ALLOWED_SECTIONS = new Set([
  "identity", "project", "checkpoint", "policy", "gaps", "score", "memories", "transcript",
]);

function validate(value: unknown): ContinuityPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("continuity policy must be a JSON object");
  }
  const candidate = { ...DEFAULT_POLICY, ...(value as Partial<ContinuityPolicy>) };
  if (candidate.schema_version !== 1) throw new Error("unsupported continuity policy schema_version");
  if (!["excluded", "tail-read-only", "captured"].includes(candidate.transcript_mode)) {
    throw new Error("invalid transcript_mode");
  }
  if (!Number.isInteger(candidate.startup_budget_bytes) || candidate.startup_budget_bytes < 1024 || candidate.startup_budget_bytes > 1_000_000) {
    throw new Error("startup_budget_bytes must be an integer from 1024 to 1000000");
  }
  for (const key of ["mandatory_sections", "optional_sections"] as const) {
    if (!Array.isArray(candidate[key]) || candidate[key].some((v) => typeof v !== "string" || !ALLOWED_SECTIONS.has(v))) {
      throw new Error(`${key} contains an unknown section`);
    }
  }
  const overlap = candidate.mandatory_sections.filter((name) => candidate.optional_sections.includes(name));
  if (overlap.length > 0) throw new Error(`sections cannot be both mandatory and optional: ${overlap.join(", ")}`);
  const assigned = new Set([...candidate.mandatory_sections, ...candidate.optional_sections]);
  const missing = [...ALLOWED_SECTIONS].filter((name) => !assigned.has(name));
  if (missing.length > 0) throw new Error(`sections must be classified as mandatory or optional: ${missing.join(", ")}`);
  if (typeof candidate.background_writes_allowed !== "boolean") throw new Error("background_writes_allowed must be boolean");
  return candidate;
}

export function loadPolicy(baseDir: string): LoadedPolicy {
  const path = join(baseDir, ".rekindle", "policy.json");
  const raw = existsSync(path) ? readFileSync(path, "utf-8") : JSON.stringify(DEFAULT_POLICY);
  const policy = validate(JSON.parse(raw));
  const canonical = JSON.stringify(policy);
  return {
    policy,
    path,
    source: existsSync(path) ? "file" : "default",
    hash: createHash("sha256").update(canonical).digest("hex"),
  };
}
