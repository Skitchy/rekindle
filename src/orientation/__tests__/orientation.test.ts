import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RekindleStorage } from "../../storage/sqlite.js";
import { detectGaps } from "../GapDetector.js";
import { calculateScore } from "../Scorer.js";
import { OrientationService } from "../OrientationService.js";
import { OrientationRenderer } from "../OrientationRenderer.js";
import { displayRegistryPath } from "../OrientationService.js";
import { homedir } from "node:os";
import type { MemoryStats } from "../../storage/sqlite.js";

function emptyStats(): MemoryStats {
  return { total: 0, byCategory: {}, byProject: {}, recentCount: 0 };
}

function fullStats(): MemoryStats {
  return {
    total: 14,
    byCategory: { preference: 3, lesson: 2, context: 4, relationship: 2, general: 3 },
    byProject: { myproject: 10, "(none)": 4 },
    recentCount: 5,
  };
}

describe("GapDetector", () => {
  it("returns empty array when everything is populated", () => {
    const gaps = detectGaps(fullStats(), true, true, true);
    expect(gaps).toEqual([]);
  });

  it("detects missing identity", () => {
    const gaps = detectGaps(fullStats(), false, true, true);
    expect(gaps.some((g) => g.code === "identity_missing")).toBe(true);
    expect(gaps.find((g) => g.code === "identity_missing")!.severity).toBe("critical");
  });

  it("detects empty memories", () => {
    const gaps = detectGaps(emptyStats(), true, true, true);
    expect(gaps.some((g) => g.code === "memories_empty")).toBe(true);
  });

  it("detects empty categories", () => {
    const stats: MemoryStats = { total: 5, byCategory: { general: 5 }, byProject: {}, recentCount: 5 };
    const gaps = detectGaps(stats, true, true, true);
    const emptyCats = gaps.filter((g) => g.code.startsWith("category_empty_"));
    expect(emptyCats.length).toBe(4);
    expect(emptyCats.every((g) => g.severity === "info")).toBe(true);
  });

  it("detects stale recent memories", () => {
    const stats: MemoryStats = { total: 10, byCategory: { general: 10 }, byProject: {}, recentCount: 0 };
    const gaps = detectGaps(stats, true, true, true);
    expect(gaps.some((g) => g.code === "recent_memory_stale")).toBe(true);
  });

  it("detects missing checkpoint", () => {
    const gaps = detectGaps(fullStats(), true, true, false);
    expect(gaps.some((g) => g.code === "checkpoint_missing")).toBe(true);
  });

  it("detects missing transcript", () => {
    const gaps = detectGaps(fullStats(), true, false, true);
    expect(gaps.some((g) => g.code === "transcript_missing")).toBe(true);
  });

  it("treats transcript exclusion as policy compliance", () => {
    const gaps = detectGaps(fullStats(), true, false, true, "excluded");
    expect(gaps.some((g) => g.code === "transcript_missing")).toBe(false);
  });

  it("returns multiple gaps simultaneously", () => {
    const gaps = detectGaps(emptyStats(), false, false, false);
    expect(gaps.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Scorer", () => {
  it("returns 100 when everything is present", () => {
    const { score, breakdown } = calculateScore(true, true, true, fullStats());
    expect(score).toBe(100);
    expect(breakdown).toHaveLength(6);
    expect(breakdown.every((b) => b.earned)).toBe(true);
  });

  it("returns 0 when nothing is present", () => {
    const { score } = calculateScore(false, false, false, emptyStats());
    expect(score).toBe(0);
  });

  it("returns 20 for identity-only", () => {
    const { score } = calculateScore(true, false, false, emptyStats());
    expect(score).toBe(20);
  });

  it("returns 40 for identity + checkpoint", () => {
    const { score } = calculateScore(true, true, false, emptyStats());
    expect(score).toBe(40);
  });

  it("scores relationship/preference categories", () => {
    const stats: MemoryStats = {
      total: 1,
      byCategory: { preference: 1 },
      byProject: {},
      recentCount: 1,
    };
    const { score } = calculateScore(false, false, false, stats);
    expect(score).toBe(30); // 20 recent + 10 rel/pref
  });

  it("scores project-scoped memories", () => {
    const stats: MemoryStats = {
      total: 1,
      byCategory: {},
      byProject: { myproject: 1 },
      recentCount: 1,
    };
    const { score } = calculateScore(false, false, false, stats);
    expect(score).toBe(30); // 20 recent + 10 project
  });

  it("breakdown has 6 items", () => {
    const { breakdown } = calculateScore(false, false, false, emptyStats());
    expect(breakdown).toHaveLength(6);
  });

  it("marks an excluded transcript N/A and normalizes applicable points", () => {
    const { score, possiblePoints, breakdown } = calculateScore(true, true, false, fullStats(), "myproject", "excluded");
    expect(score).toBe(100);
    expect(possiblePoints).toBe(80);
    expect(breakdown.find((b) => b.label === "Session transcript found")?.applicable).toBe(false);
  });

  it("does not award project scope when the active project is unresolved", () => {
    const { score, breakdown } = calculateScore(true, true, true, fullStats(), undefined, "captured", false);
    expect(breakdown.find((b) => b.label === "Active project resolved")?.earned).toBe(false);
    expect(score).toBe(90);
  });
});

describe("OrientationService", () => {
  let storage: RekindleStorage;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "rekindle-orientation-"));
    storage = new RekindleStorage(join(tmpDir, "db", "memories.db"));
  });

  afterEach(() => {
    storage.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates result with all data present", () => {
    const identityPath = join(tmpDir, "identity.md");
    writeFileSync(identityPath, "I am a test identity");

    const transcriptDir = join(tmpDir, "transcripts");
    mkdirSync(transcriptDir);
    writeFileSync(join(transcriptDir, "session-2026-05-06.md"), "Test transcript content");

    storage.store("checkpoint content", "context", 8);
    storage.store("user likes direct feedback", "preference", 6);

    const service = new OrientationService(storage);
    const result = service.generate({ identityPath, transcriptDir });

    expect(result.identity.loaded).toBe(true);
    expect(result.identity.content).toBe("I am a test identity");
    expect(result.checkpoint.exists).toBe(true);
    expect(result.transcript.exists).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it("generates result with empty state", () => {
    const service = new OrientationService(storage);
    const result = service.generate({
      identityPath: join(tmpDir, "missing.md"),
      transcriptDir: join(tmpDir, "missing-dir"),
    });

    expect(result.identity.loaded).toBe(false);
    expect(result.checkpoint.exists).toBe(false);
    expect(result.transcript.exists).toBe(false);
    expect(result.gaps.length).toBeGreaterThan(0);
    expect(result.score).toBe(0);
  });

  it("truncates long transcript content to 1500 chars", () => {
    const transcriptDir = join(tmpDir, "transcripts");
    mkdirSync(transcriptDir);
    writeFileSync(join(transcriptDir, "long.md"), "x".repeat(3000));

    const service = new OrientationService(storage);
    const result = service.generate({
      identityPath: join(tmpDir, "missing.md"),
      transcriptDir,
    });

    expect(result.transcript.exists).toBe(true);
    expect(result.transcript.preview!.length).toBeLessThan(3000);
    expect(result.transcript.preview).toContain("[...truncated]");
  });

  it("finds latest transcript by name sort", () => {
    const transcriptDir = join(tmpDir, "transcripts");
    mkdirSync(transcriptDir);
    writeFileSync(join(transcriptDir, "session-2026-05-01.md"), "old");
    writeFileSync(join(transcriptDir, "session-2026-05-06.md"), "new");

    const service = new OrientationService(storage);
    const result = service.generate({
      identityPath: join(tmpDir, "missing.md"),
      transcriptDir,
    });

    expect(result.transcript.name).toBe("session-2026-05-06.md");
    expect(result.transcript.preview).toBe("new");
  });
});

describe("OrientationRenderer", () => {
  it("toMarkdown produces expected section headers", () => {
    const service = new OrientationService(
      new RekindleStorage(join(mkdtempSync(join(tmpdir(), "rk-render-")), "db", "memories.db"))
    );
    const result = service.generate({
      identityPath: "/nonexistent",
      transcriptDir: "/nonexistent",
    });
    const md = OrientationRenderer.toMarkdown(result);

    expect(md).toContain("## Identity");
    expect(md).toContain("## Memories");
    expect(md).toContain("## Last Checkpoint");
    expect(md).toContain("## Last Session Transcript");
    expect(md).toContain("## Gaps Detected");
    expect(md).toContain("## Orientation Score");
  });

  it("toMarkdown includes score disclaimer", () => {
    const service = new OrientationService(
      new RekindleStorage(join(mkdtempSync(join(tmpdir(), "rk-render-")), "db", "memories.db"))
    );
    const result = service.generate({
      identityPath: "/nonexistent",
      transcriptDir: "/nonexistent",
    });
    const md = OrientationRenderer.toMarkdown(result);
    expect(md).toContain("structural checklist");
  });

  it("toJSON produces parseable JSON", () => {
    const service = new OrientationService(
      new RekindleStorage(join(mkdtempSync(join(tmpdir(), "rk-render-")), "db", "memories.db"))
    );
    const result = service.generate({
      identityPath: "/nonexistent",
      transcriptDir: "/nonexistent",
    });
    const json = OrientationRenderer.toJSON(result);
    const parsed = JSON.parse(json);
    expect(parsed.score).toBeDefined();
    expect(parsed.gaps).toBeInstanceOf(Array);
    expect(parsed.scoreBreakdown).toBeInstanceOf(Array);
  });
});

describe("OrientationService project gap messages", () => {
  function service() {
    return new OrientationService(
      new RekindleStorage(join(mkdtempSync(join(tmpdir(), "rk-gap-")), "db", "memories.db"))
    );
  }
  const base = { identityPath: "/nonexistent", transcriptDir: "/nonexistent", allowCheckpointLookup: false };

  it("unknown workspace: says no checkpoint was loaded and names both remedies with a relative registry path", () => {
    const result = service().generate({
      ...base,
      projectResolution: {
        status: "unknown", project: null, rule: "unknown", cwd: "/abs/secret/path",
        registry_path: "/abs/secret/.rekindle/projects.json", override_registered: null,
      },
    });
    const gap = result.gaps.find((g) => g.code === "project_unknown");
    expect(gap).toBeDefined();
    expect(gap!.severity).toBe("warning");
    expect(gap!.message).toContain("no checkpoint was loaded");
    expect(gap!.message).toContain(".rekindle/projects.json");
    expect(gap!.message).toContain("REKINDLE_PROJECT");
    expect(gap!.message).not.toContain("/abs/secret");
  });

  it("ambiguous workspace: distinct code, same two remedies, no absolute path", () => {
    const result = service().generate({
      ...base,
      projectResolution: {
        status: "ambiguous", project: null, rule: "ambiguous", cwd: "/abs/secret/path",
        registry_path: "/abs/secret/.rekindle/projects.json", override_registered: null,
      },
    });
    const gap = result.gaps.find((g) => g.code === "project_ambiguous");
    expect(gap).toBeDefined();
    expect(gap!.message).toContain("more than one project");
    expect(gap!.message).toContain("no checkpoint was loaded");
    expect(gap!.message).toContain(".rekindle/projects.json");
    expect(gap!.message).toContain("REKINDLE_PROJECT");
    expect(gap!.message).not.toContain("/abs/secret");
    expect(result.gaps.some((g) => g.code === "project_unknown")).toBe(false);
  });

  it("resolved workspace: no project gap", () => {
    const result = service().generate({
      ...base,
      projectResolution: {
        status: "resolved", project: "alpha", rule: "exact-root", cwd: "/w/alpha",
        registry_path: "/w/.rekindle/projects.json", override_registered: null,
      },
    });
    expect(result.gaps.some((g) => g.code.startsWith("project_"))).toBe(false);
  });
});

describe("displayRegistryPath", () => {
  it("home-rooted store (the --global case) shows ~/.rekindle/projects.json", () => {
    expect(displayRegistryPath("/home/u/.rekindle/projects.json", "/home/u/work/repo", "/home/u")).toBe("~/.rekindle/projects.json");
  });

  it("workspace-rooted store shows the path relative to the workspace", () => {
    expect(displayRegistryPath("/w/repo/.rekindle/projects.json", "/w/repo", "/home/u")).toBe(".rekindle/projects.json");
  });

  it("any other root falls back to the generic relative form, never an absolute path", () => {
    expect(displayRegistryPath("/srv/store/.rekindle/projects.json", "/w/repo", "/home/u")).toBe(".rekindle/projects.json");
    expect(displayRegistryPath("/srv/store/.rekindle/projects.json", null, "/home/u")).toBe(".rekindle/projects.json");
  });

  it("does not treat a sibling directory with a shared prefix as inside home", () => {
    expect(displayRegistryPath("/home/user2/.rekindle/projects.json", null, "/home/u")).toBe(".rekindle/projects.json");
  });

  it("gap message under a home-rooted store names ~/.rekindle/projects.json", () => {
    const service = new OrientationService(
      new RekindleStorage(join(mkdtempSync(join(tmpdir(), "rk-gap-home-")), "db", "memories.db"))
    );
    const result = service.generate({
      identityPath: "/nonexistent", transcriptDir: "/nonexistent", allowCheckpointLookup: false,
      projectResolution: {
        status: "unknown", project: null, rule: "unknown", cwd: "/somewhere/else",
        registry_path: join(homedir(), ".rekindle", "projects.json"), override_registered: null,
      },
    });
    const gap = result.gaps.find((g) => g.code === "project_unknown");
    expect(gap!.message).toContain("~/.rekindle/projects.json");
    expect(gap!.message).not.toContain(homedir());
  });
});

describe("unfilled identity template (#31)", () => {
  it("treats the shipped template as no content, and real text as content", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { identityHasContent } = await import("../identity-content.js");
    const template = readFileSync(join(__dirname, "..", "..", "init", "templates", "identity.md"), "utf-8");
    expect(identityHasContent(template)).toBe(false);
    expect(identityHasContent(template + "\nI'm CC. Direct, no fluff.\n")).toBe(true);
    expect(identityHasContent("# Just a heading\n<!-- a comment -->\n")).toBe(false);
    // An unclosed comment is still a comment, through the end of the file.
    expect(identityHasContent("<!-- TODO fill this in")).toBe(false);
    expect(identityHasContent("# Identity\n<!-- TODO\nstill inside the comment\n")).toBe(false);
    expect(identityHasContent("Real line.\n<!-- unfinished")).toBe(true);
  });

  it("scores 0 for identity and reports a gap when the identity is the template", () => {
    const gaps = detectGaps(fullStats(), true, true, true, "captured", false);
    expect(gaps.some((g) => g.code === "identity_unfilled")).toBe(true);
    expect(gaps.some((g) => g.code === "identity_missing")).toBe(false);
    expect(detectGaps(fullStats(), true, true, true).some((g) => g.code === "identity_unfilled")).toBe(false);
  });
});
