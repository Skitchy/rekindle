import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type {
  CaptureEntry,
  CaptureManifest,
  StructuredSnapshot,
  TranscriptEntry,
  CaptureConfig,
  HookInput,
} from "./types.js";
import { DEFAULT_CAPTURE_CONFIG } from "./types.js";

export class CaptureManager {
  private config: CaptureConfig;
  private baseDir: string;

  constructor(baseDir: string, config?: Partial<CaptureConfig>) {
    this.baseDir = baseDir;
    this.config = { ...DEFAULT_CAPTURE_CONFIG, ...config };
  }

  private get capturesDir(): string {
    return resolve(this.baseDir, this.config.capturesDir);
  }

  private get manifestPath(): string {
    return join(this.capturesDir, "manifest.json");
  }

  readManifest(): CaptureManifest {
    if (!existsSync(this.manifestPath)) {
      return { version: 1, captures: [] };
    }
    const raw = readFileSync(this.manifestPath, "utf-8");
    return JSON.parse(raw) as CaptureManifest;
  }

  private writeManifest(manifest: CaptureManifest): void {
    mkdirSync(this.capturesDir, { recursive: true });
    writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2));
  }

  private nextSequence(sessionId: string): number {
    const manifest = this.readManifest();
    const sessionCaptures = manifest.captures.filter(
      (c) => c.session_id === sessionId
    );
    return sessionCaptures.length + 1;
  }

  parseTranscript(transcriptPath: string): TranscriptEntry[] {
    if (!existsSync(transcriptPath)) return [];

    const content = readFileSync(transcriptPath, "utf-8");
    const entries: TranscriptEntry[] = [];

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.isSidechain) continue;
        if (obj.type !== "user" && obj.type !== "assistant") continue;

        const msg = obj.message ?? {};
        const text = extractText(msg.content);
        if (!text) continue;

        entries.push({
          timestamp: obj.timestamp ?? "",
          role: obj.type === "user" ? "human" : "assistant",
          text,
        });
      } catch {
        continue;
      }
    }

    return entries;
  }

  capture(input: HookInput, source: CaptureEntry["source"] = "precompact_hook"): CaptureEntry | null {
    const entries = this.parseTranscript(input.transcript_path);
    if (entries.length === 0) return null;

    const tail = this.applyLimits(entries);
    if (tail.length === 0) return null;

    const sessionId = input.session_id;
    const sequence = this.nextSequence(sessionId);
    const now = new Date().toISOString();
    const captureId = `precompact-${sessionId.slice(0, 12)}-${String(sequence).padStart(3, "0")}`;

    const rawFilename = `${captureId}.md`;
    const jsonFilename = `${captureId}.json`;
    const rawPath = join(this.config.capturesDir, rawFilename);
    const jsonPath = join(this.config.capturesDir, jsonFilename);

    const rawContent = this.renderRawCapture(tail, {
      sessionId,
      sequence,
      totalEntries: entries.length,
      capturedAt: now,
    });

    const charCount = rawContent.length;

    const snapshot: StructuredSnapshot = {
      type: "precompact_capture",
      source,
      session_id: sessionId,
      project: deriveProject(input.cwd),
      captured_at: now,
      sequence,
      reason: source === "precompact_hook" ? "before_context_compaction" : "manual_capture",
      raw_path: rawPath,
      extraction_method: "script_generated",
      confidence: "low",
      raw_capture_available: true,
      requires_review: true,
      summary: "",
      decisions: [],
      open_loops: [],
      active_files: extractActiveFiles(tail),
      warnings: [],
      context_shifts: "",
    };

    mkdirSync(this.capturesDir, { recursive: true });
    writeFileSync(resolve(this.baseDir, rawPath), rawContent);
    writeFileSync(resolve(this.baseDir, jsonPath), JSON.stringify(snapshot, null, 2));

    const entry: CaptureEntry = {
      id: captureId,
      session_id: sessionId,
      sequence,
      type: "precompact_capture",
      source,
      captured_at: now,
      project: snapshot.project,
      cwd: input.cwd,
      raw_path: rawPath,
      json_path: jsonPath,
      message_count: tail.length,
      char_count: charCount,
      status: "active",
    };

    const manifest = this.readManifest();
    manifest.captures.push(entry);
    this.writeManifest(manifest);

    return entry;
  }

  listCaptures(sessionId?: string): CaptureEntry[] {
    const manifest = this.readManifest();
    if (sessionId) {
      return manifest.captures.filter((c) => c.session_id === sessionId);
    }
    return manifest.captures;
  }

  readCapture(id: string, mode: "summary" | "structured" | "raw"): string | null {
    const manifest = this.readManifest();
    const entry = manifest.captures.find((c) => c.id === id);
    if (!entry) return null;

    if (mode === "raw") {
      const rawFullPath = resolve(this.baseDir, entry.raw_path);
      if (!existsSync(rawFullPath)) return null;
      return readFileSync(rawFullPath, "utf-8");
    }

    if (mode === "structured") {
      const jsonFullPath = resolve(this.baseDir, entry.json_path);
      if (!existsSync(jsonFullPath)) return null;
      return readFileSync(jsonFullPath, "utf-8");
    }

    // mode === "summary"
    const jsonFullPath = resolve(this.baseDir, entry.json_path);
    if (!existsSync(jsonFullPath)) {
      return `Capture ${entry.id}: ${entry.message_count} messages captured at ${entry.captured_at}. No structured summary available.`;
    }
    const snapshot = JSON.parse(readFileSync(jsonFullPath, "utf-8")) as StructuredSnapshot;
    if (snapshot.summary) {
      return snapshot.summary;
    }
    return `Capture ${entry.id}: ${entry.message_count} messages captured at ${entry.captured_at}. Structured snapshot exists but no summary generated yet (requires_review: true).`;
  }

  hasUnreviewedCaptures(sessionId: string): boolean {
    const captures = this.listCaptures(sessionId);
    return captures.length > 0;
  }

  private applyLimits(entries: TranscriptEntry[]): TranscriptEntry[] {
    const maxMessages = parseInt(
      process.env.REKINDLE_PRECOMPACT_MAX_MESSAGES ?? String(this.config.maxMessages),
      10
    );
    const maxChars = parseInt(
      process.env.REKINDLE_PRECOMPACT_MAX_CHARS ?? String(this.config.maxChars),
      10
    );

    let tail = entries.slice(-maxMessages);

    let totalChars = tail.reduce((sum, e) => sum + e.text.length, 0);
    while (totalChars > maxChars && tail.length > 1) {
      tail = tail.slice(1);
      totalChars = tail.reduce((sum, e) => sum + e.text.length, 0);
    }

    return tail;
  }

  private renderRawCapture(
    entries: TranscriptEntry[],
    meta: { sessionId: string; sequence: number; totalEntries: number; capturedAt: string }
  ): string {
    const lines: string[] = [
      `# Pre-Compaction Capture #${meta.sequence}`,
      `Session: \`${meta.sessionId}\``,
      `Captured: ${meta.capturedAt}`,
      `Exchanges: ${entries.length} (of ${meta.totalEntries} total)`,
      "",
      "---",
      "",
    ];

    for (const entry of entries) {
      const name = entry.role === "human" ? this.config.humanName : this.config.aiName;
      const time = formatTime(entry.timestamp);
      lines.push(`## ${name}${time ? ` — ${time}` : ""}`);
      lines.push("");
      lines.push(entry.text);
      lines.push("");
    }

    return lines.join("\n").trimEnd() + "\n";
  }
}

function extractText(content: unknown): string | null {
  if (typeof content === "string") {
    return content.trim() || null;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "object" && block !== null && "type" in block) {
        const b = block as { type: string; text?: string };
        if (b.type === "text" && b.text?.trim()) {
          parts.push(b.text.trim());
        }
      }
    }
    const joined = parts.join("\n\n").trim();
    return joined || null;
  }
  return null;
}

function extractActiveFiles(entries: TranscriptEntry[]): string[] {
  const files = new Set<string>();
  const filePattern = /(?:^|\s)((?:\/|\.\/|~\/)[^\s,;:'"]+\.\w+)/g;

  for (const entry of entries.slice(-20)) {
    let match: RegExpExecArray | null;
    while ((match = filePattern.exec(entry.text)) !== null) {
      files.add(match[1]);
    }
  }

  return [...files].slice(0, 20);
}

function deriveProject(cwd: string): string | null {
  const parts = cwd.split("/");
  const last = parts[parts.length - 1];
  return last || null;
}

function formatTime(ts: string): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return "";
  }
}
