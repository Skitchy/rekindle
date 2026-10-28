import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CaptureManager } from "../CaptureManager.js";
import type { HookInput } from "../types.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;
let manager: CaptureManager;

function makeTranscriptLine(type: "user" | "assistant", text: string, opts?: { isSidechain?: boolean; timestamp?: string }): string {
  return JSON.stringify({
    type,
    timestamp: opts?.timestamp ?? "2026-05-07T10:00:00Z",
    isSidechain: opts?.isSidechain ?? false,
    message: { content: text },
  });
}

function writeTranscript(lines: string[]): string {
  const path = join(tmpDir, "transcript.jsonl");
  writeFileSync(path, lines.join("\n"));
  return path;
}

function makeInput(transcriptPath: string, sessionId = "test-session-abc123"): HookInput {
  return {
    session_id: sessionId,
    transcript_path: transcriptPath,
    cwd: tmpDir,
    hook_event_name: "PreCompact",
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "rekindle-capture-test-"));
  manager = new CaptureManager(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("parseTranscript", () => {
  it("parses user and assistant messages from JSONL", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", "Hello"),
      makeTranscriptLine("assistant", "Hi there"),
      makeTranscriptLine("user", "How are you?"),
    ]);

    const entries = manager.parseTranscript(path);
    expect(entries).toHaveLength(3);
    expect(entries[0].role).toBe("human");
    expect(entries[0].text).toBe("Hello");
    expect(entries[1].role).toBe("assistant");
    expect(entries[1].text).toBe("Hi there");
    expect(entries[2].role).toBe("human");
    expect(entries[2].text).toBe("How are you?");
  });

  it("skips sidechain messages", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", "Main message"),
      makeTranscriptLine("assistant", "Sidechain response", { isSidechain: true }),
      makeTranscriptLine("assistant", "Main response"),
    ]);

    const entries = manager.parseTranscript(path);
    expect(entries).toHaveLength(2);
    expect(entries[1].text).toBe("Main response");
  });

  it("skips non-user/assistant types", () => {
    const path = join(tmpDir, "transcript.jsonl");
    writeFileSync(path, [
      JSON.stringify({ type: "system", message: { content: "System msg" } }),
      makeTranscriptLine("user", "Real message"),
    ].join("\n"));

    const entries = manager.parseTranscript(path);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe("Real message");
  });

  it("handles array content blocks", () => {
    const path = join(tmpDir, "transcript.jsonl");
    writeFileSync(path, JSON.stringify({
      type: "user",
      timestamp: "2026-05-07T10:00:00Z",
      isSidechain: false,
      message: {
        content: [
          { type: "text", text: "First part" },
          { type: "image", url: "http://example.com/img.png" },
          { type: "text", text: "Second part" },
        ],
      },
    }));

    const entries = manager.parseTranscript(path);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe("First part\n\nSecond part");
  });

  it("returns empty array for missing file", () => {
    const entries = manager.parseTranscript("/nonexistent/path.jsonl");
    expect(entries).toEqual([]);
  });

  it("skips malformed JSON lines gracefully", () => {
    const path = join(tmpDir, "transcript.jsonl");
    writeFileSync(path, [
      "not valid json",
      makeTranscriptLine("user", "Valid message"),
      "{broken",
    ].join("\n"));

    const entries = manager.parseTranscript(path);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe("Valid message");
  });

  it("skips entries with empty text", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", ""),
      makeTranscriptLine("user", "   "),
      makeTranscriptLine("user", "Actual content"),
    ]);

    const entries = manager.parseTranscript(path);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe("Actual content");
  });
});

describe("capture", () => {
  it("returns null for empty transcript", () => {
    const path = writeTranscript([]);
    const result = manager.capture(makeInput(path));
    expect(result).toBeNull();
  });

  it("returns null for nonexistent transcript", () => {
    const result = manager.capture(makeInput("/no/such/file.jsonl"));
    expect(result).toBeNull();
  });

  it("captures a valid transcript and writes files", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", "Hello"),
      makeTranscriptLine("assistant", "Hi there! How can I help?"),
    ]);

    const entry = manager.capture(makeInput(path));
    expect(entry).not.toBeNull();
    expect(entry!.session_id).toBe("test-session-abc123");
    expect(entry!.sequence).toBe(1);
    expect(entry!.message_count).toBe(2);
    expect(entry!.source).toBe("precompact_hook");
    expect(entry!.status).toBe("active");
    expect(entry!.id).toMatch(/^precompact-test-session-001$/);

    const rawFullPath = join(tmpDir, entry!.raw_path);
    expect(existsSync(rawFullPath)).toBe(true);
    const rawContent = readFileSync(rawFullPath, "utf-8");
    expect(rawContent).toContain("# Pre-Compaction Capture #1");
    expect(rawContent).toContain("Hello");
    expect(rawContent).toContain("Hi there! How can I help?");

    const jsonFullPath = join(tmpDir, entry!.json_path);
    expect(existsSync(jsonFullPath)).toBe(true);
    const snapshot = JSON.parse(readFileSync(jsonFullPath, "utf-8"));
    expect(snapshot.type).toBe("precompact_capture");
    expect(snapshot.source).toBe("precompact_hook");
    expect(snapshot.requires_review).toBe(true);
  });

  it("increments sequence for same session", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", "First exchange"),
      makeTranscriptLine("assistant", "Response"),
    ]);

    const entry1 = manager.capture(makeInput(path));
    const entry2 = manager.capture(makeInput(path));

    expect(entry1!.sequence).toBe(1);
    expect(entry2!.sequence).toBe(2);
    expect(entry1!.id).toContain("-001");
    expect(entry2!.id).toContain("-002");
  });

  it("uses different source when specified", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", "Manual capture"),
      makeTranscriptLine("assistant", "Response"),
    ]);

    const entry = manager.capture(makeInput(path), "model_requested");
    expect(entry!.source).toBe("model_requested");
  });

  it("does not guess a project from the folder name when none resolves", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", "Hello"),
      makeTranscriptLine("assistant", "Hi"),
    ]);

    const input = makeInput(path);
    input.cwd = "/home/user/projects/my-project";
    const entry = manager.capture(input);
    expect(entry!.project).toBeNull();
  });

  it("passes custom reason to snapshot", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", "Hello"),
      makeTranscriptLine("assistant", "Hi"),
    ]);

    const entry = manager.capture(makeInput(path), "model_requested", "context feels at risk");
    const structured = manager.readCapture(entry!.id, "structured");
    const snapshot = JSON.parse(structured!);
    expect(snapshot.reason).toBe("context feels at risk");
  });
});

describe("applyLimits", () => {
  it("respects maxMessages config", () => {
    const smallManager = new CaptureManager(tmpDir, { maxMessages: 3 });
    const lines: string[] = [];
    for (let i = 0; i < 10; i++) {
      lines.push(makeTranscriptLine("user", `Message ${i}`));
    }
    const path = writeTranscript(lines);
    const entry = smallManager.capture(makeInput(path));
    expect(entry!.message_count).toBe(3);
  });

  it("respects maxChars config", () => {
    const smallManager = new CaptureManager(tmpDir, { maxMessages: 100, maxChars: 50 });
    const lines = [
      makeTranscriptLine("user", "A".repeat(30)),
      makeTranscriptLine("assistant", "B".repeat(30)),
      makeTranscriptLine("user", "C".repeat(30)),
    ];
    const path = writeTranscript(lines);
    const entry = smallManager.capture(makeInput(path));
    expect(entry!.message_count).toBeLessThan(3);
  });

  it("keeps tail (most recent messages)", () => {
    const smallManager = new CaptureManager(tmpDir, { maxMessages: 2 });
    const lines = [
      makeTranscriptLine("user", "Old message"),
      makeTranscriptLine("assistant", "Old response"),
      makeTranscriptLine("user", "Recent message"),
      makeTranscriptLine("assistant", "Recent response"),
    ];
    const path = writeTranscript(lines);
    const entry = smallManager.capture(makeInput(path));

    const raw = readFileSync(join(tmpDir, entry!.raw_path), "utf-8");
    expect(raw).not.toContain("Old message");
    expect(raw).toContain("Recent message");
    expect(raw).toContain("Recent response");
  });
});

describe("listCaptures", () => {
  it("returns empty array with no captures", () => {
    const captures = manager.listCaptures();
    expect(captures).toEqual([]);
  });

  it("returns all captures", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", "Hello"),
      makeTranscriptLine("assistant", "Hi"),
    ]);

    manager.capture(makeInput(path, "session-1"));
    manager.capture(makeInput(path, "session-2"));

    const captures = manager.listCaptures();
    expect(captures).toHaveLength(2);
  });

  it("filters by session ID", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", "Hello"),
      makeTranscriptLine("assistant", "Hi"),
    ]);

    manager.capture(makeInput(path, "session-1"));
    manager.capture(makeInput(path, "session-2"));
    manager.capture(makeInput(path, "session-1"));

    const session1 = manager.listCaptures("session-1");
    expect(session1).toHaveLength(2);

    const session2 = manager.listCaptures("session-2");
    expect(session2).toHaveLength(1);
  });
});

describe("readCapture", () => {
  it("returns null for nonexistent capture", () => {
    const result = manager.readCapture("nonexistent-id", "raw");
    expect(result).toBeNull();
  });

  it("reads raw mode (full markdown)", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", "Tell me about X"),
      makeTranscriptLine("assistant", "X is a thing that does Y"),
    ]);

    const entry = manager.capture(makeInput(path));
    const raw = manager.readCapture(entry!.id, "raw");
    expect(raw).toContain("# Pre-Compaction Capture #1");
    expect(raw).toContain("Tell me about X");
    expect(raw).toContain("X is a thing that does Y");
  });

  it("reads structured mode (JSON snapshot)", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", "Hello"),
      makeTranscriptLine("assistant", "Hi"),
    ]);

    const entry = manager.capture(makeInput(path));
    const structured = manager.readCapture(entry!.id, "structured");
    const parsed = JSON.parse(structured!);
    expect(parsed.type).toBe("precompact_capture");
    expect(parsed.requires_review).toBe(true);
    expect(parsed.session_id).toBe("test-session-abc123");
  });

  it("reads summary mode (brief text)", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", "Hello"),
      makeTranscriptLine("assistant", "Hi"),
    ]);

    const entry = manager.capture(makeInput(path));
    const summary = manager.readCapture(entry!.id, "summary");
    expect(summary).toContain(entry!.id);
    expect(summary).toContain("2 messages");
    expect(summary).toContain("requires_review: true");
  });
});

describe("hasUnreviewedCaptures", () => {
  it("returns false with no captures", () => {
    expect(manager.hasUnreviewedCaptures("any-session")).toBe(false);
  });

  it("returns true when session has unreviewed captures", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", "Hello"),
      makeTranscriptLine("assistant", "Hi"),
    ]);

    manager.capture(makeInput(path, "my-session"));
    expect(manager.hasUnreviewedCaptures("my-session")).toBe(true);
  });

  it("returns false after capture is read", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", "Hello"),
      makeTranscriptLine("assistant", "Hi"),
    ]);

    const entry = manager.capture(makeInput(path, "my-session"));
    manager.readCapture(entry!.id, "summary");
    expect(manager.hasUnreviewedCaptures("my-session")).toBe(false);
  });

  it("returns true if only some captures are reviewed", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", "Hello"),
      makeTranscriptLine("assistant", "Hi"),
    ]);

    const entry1 = manager.capture(makeInput(path, "my-session"));
    manager.capture(makeInput(path, "my-session"));
    manager.readCapture(entry1!.id, "raw");
    expect(manager.hasUnreviewedCaptures("my-session")).toBe(true);
  });

  it("returns false for different session", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", "Hello"),
      makeTranscriptLine("assistant", "Hi"),
    ]);

    manager.capture(makeInput(path, "session-A"));
    expect(manager.hasUnreviewedCaptures("session-B")).toBe(false);
  });
});

describe("manifest persistence", () => {
  it("survives across CaptureManager instances", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", "Hello"),
      makeTranscriptLine("assistant", "Hi"),
    ]);

    manager.capture(makeInput(path));

    const manager2 = new CaptureManager(tmpDir);
    const captures = manager2.listCaptures();
    expect(captures).toHaveLength(1);
    expect(captures[0].session_id).toBe("test-session-abc123");
  });
});

describe("raw capture formatting", () => {
  it("uses configured human/AI names", () => {
    const customManager = new CaptureManager(tmpDir, {
      humanName: "Skitch",
      aiName: "CC",
    });

    const path = writeTranscript([
      makeTranscriptLine("user", "Hey CC"),
      makeTranscriptLine("assistant", "Hey Skitch!"),
    ]);

    const entry = customManager.capture(makeInput(path));
    const raw = readFileSync(join(tmpDir, entry!.raw_path), "utf-8");
    expect(raw).toContain("## Skitch");
    expect(raw).toContain("## CC");
    expect(raw).not.toContain("## Human");
    expect(raw).not.toContain("## Assistant");
  });

  it("includes metadata header", () => {
    const path = writeTranscript([
      makeTranscriptLine("user", "Hello"),
      makeTranscriptLine("assistant", "Hi"),
    ]);

    const entry = manager.capture(makeInput(path));
    const raw = readFileSync(join(tmpDir, entry!.raw_path), "utf-8");
    expect(raw).toContain("Session: `test-session-abc123`");
    expect(raw).toContain("Exchanges: 2");
  });
});

describe("capture project tagging (#30)", () => {
  function captureFrom(cwd: string, env: Record<string, string | undefined> = {}) {
    const path = writeTranscript([makeTranscriptLine("user", "Hello"), makeTranscriptLine("assistant", "Hi")]);
    const input = makeInput(path);
    input.cwd = cwd;
    return new CaptureManager(tmpDir, undefined, env).capture(input);
  }

  it("uses the project projects.json resolves, not the folder name, when they differ", () => {
    const work = join(tmpDir, "skitch");
    mkdirSync(work);
    mkdirSync(join(tmpDir, ".rekindle"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".rekindle", "projects.json"),
      JSON.stringify({ schema_version: 1, projects: [{ name: "claude-code", root: work }] })
    );
    expect(captureFrom(work)!.project).toBe("claude-code");
  });

  it("honors REKINDLE_PROJECT the way boot does", () => {
    expect(captureFrom("/home/user/projects/my-project", { REKINDLE_PROJECT: "override" })!.project).toBe("override");
  });

  function registry(projects: Array<{ name: string; root: string; include_descendants?: boolean }>) {
    mkdirSync(join(tmpDir, ".rekindle"), { recursive: true });
    writeFileSync(join(tmpDir, ".rekindle", "projects.json"), JSON.stringify({ schema_version: 1, projects }));
  }

  function snapshotOf(entry: { json_path: string }) {
    return JSON.parse(readFileSync(join(tmpDir, entry.json_path), "utf-8")) as { project: string | null; warnings: string[] };
  }

  it("keeps an ambiguous capture unscoped, with a warning, instead of guessing", () => {
    const shared = join(tmpDir, "shared");
    mkdirSync(shared);
    registry([
      { name: "one", root: shared },
      { name: "two", root: shared },
    ]);
    const entry = captureFrom(shared)!;
    expect(entry.project).toBeNull();
    expect(snapshotOf(entry).warnings).toEqual(["Project not attributed (ambiguous); capture kept unscoped."]);
  });

  it("never files a capture under another project whose name matches the folder name", () => {
    const elsewhere = join(tmpDir, "elsewhere");
    mkdirSync(elsewhere);
    registry([{ name: "my-project", root: elsewhere }]);
    expect(captureFrom("/home/user/projects/my-project")!.project).toBeNull();
  });

  it("keeps the capture, unscoped, when the registry is unreadable or invalid", () => {
    mkdirSync(join(tmpDir, ".rekindle"), { recursive: true });
    for (const bad of ["{ broken", JSON.stringify({ schema_version: 2, projects: [] })]) {
      writeFileSync(join(tmpDir, ".rekindle", "projects.json"), bad);
      const entry = captureFrom("/home/user/projects/my-project")!;
      expect(entry.project).toBeNull();
      expect(snapshotOf(entry).warnings).toEqual(["Project registry could not be read; capture kept unscoped."]);
    }
  });

  it("with no registry, captures are unscoped with an unknown-attribution warning", () => {
    const entry = captureFrom("/home/user/projects/my-project")!;
    expect(entry.project).toBeNull();
    expect(snapshotOf(entry).warnings).toEqual(["Project not attributed (unknown); capture kept unscoped."]);
  });
});
