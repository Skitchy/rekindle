import { describe, it, expect } from "vitest";
import { resolveCaptureTarget } from "../capture-now.js";

const newest = { sessionId: "newest-session", transcriptPath: "/p/newest-session.jsonl" };

describe("capture_now target resolution (#28)", () => {
  it("takes the session id from a supplied path, without running discovery", () => {
    let called = false;
    const target = resolveCaptureTarget(undefined, "/p/abc-123.jsonl", () => {
      called = true;
      return newest;
    });
    expect(target).toEqual({ ok: true, sessionId: "abc-123", transcriptPath: "/p/abc-123.jsonl" });
    expect(called).toBe(false);
  });

  it("succeeds with a supplied path even when nothing is discoverable", () => {
    expect(resolveCaptureTarget(undefined, "/p/abc-123.jsonl", () => null)).toEqual({
      ok: true,
      sessionId: "abc-123",
      transcriptPath: "/p/abc-123.jsonl",
    });
  });

  it("keeps both values when both are supplied", () => {
    expect(resolveCaptureTarget("given", "/p/other.jsonl", () => newest)).toEqual({
      ok: true,
      sessionId: "given",
      transcriptPath: "/p/other.jsonl",
    });
  });

  it("refuses to pair a supplied session id with another session's transcript", () => {
    const target = resolveCaptureTarget("mine", undefined, () => newest);
    expect(target.ok).toBe(false);
    if (!target.ok) expect(target.message).toContain("belongs to session newest-session, not mine");
  });

  it("accepts discovery when it matches the supplied session id, or when neither is supplied", () => {
    expect(resolveCaptureTarget("newest-session", undefined, () => newest)).toEqual({ ok: true, ...newest });
    expect(resolveCaptureTarget(undefined, undefined, () => newest)).toEqual({ ok: true, ...newest });
    expect(resolveCaptureTarget(undefined, undefined, () => null).ok).toBe(false);
  });
});

describe("capture_now rejects unusable session ids (Ari, room 637)", () => {
  it("treats a blank supplied id as not supplied, and takes the id from the path", () => {
    expect(resolveCaptureTarget("", "/p/test.jsonl", () => null)).toEqual({
      ok: true,
      sessionId: "test",
      transcriptPath: "/p/test.jsonl",
    });
    expect(resolveCaptureTarget("   ", "/p/test.jsonl", () => null)).toEqual({
      ok: true,
      sessionId: "test",
      transcriptPath: "/p/test.jsonl",
    });
  });

  it("refuses a path whose file name yields no usable id", () => {
    for (const path of ["/p/.jsonl", "/p/ .jsonl", "/p/.hidden.jsonl"]) {
      const target = resolveCaptureTarget(undefined, path, () => newest);
      expect(target.ok).toBe(false);
    }
    expect(resolveCaptureTarget("", "/p/.jsonl", () => newest).ok).toBe(false);
  });

  it("treats a blank id with no path as not supplied", () => {
    expect(resolveCaptureTarget("", undefined, () => newest)).toEqual({ ok: true, ...newest });
  });
});

describe("capture_now with real discovery (#29 + #28)", () => {
  it("validates a discovered id, and never succeeds with a blank one", () => {
    expect(resolveCaptureTarget(undefined, undefined, () => ({ sessionId: "", transcriptPath: "/p/.jsonl" })).ok).toBe(false);
    expect(resolveCaptureTarget(undefined, undefined, () => ({ sessionId: ".hidden", transcriptPath: "/p/.hidden.jsonl" })).ok).toBe(false);
  });

  it("end to end: an owned file named .jsonl is never captured under an empty id", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { claudeProjectKey, discoverLatestTranscript } = await import("../../captures/discover-transcript.js");
    const home = mkdtempSync(join(tmpdir(), "rekindle-capture-e2e-"));
    try {
      const cwd = "/projects/e2e";
      const dir = join(home, ".claude", "projects", claudeProjectKey(cwd));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, ".jsonl"), JSON.stringify({ cwd }) + "\n");
      expect(resolveCaptureTarget(undefined, undefined, () => discoverLatestTranscript(cwd, home)).ok).toBe(false);

      writeFileSync(join(dir, "real-session.jsonl"), JSON.stringify({ cwd }) + "\n");
      expect(resolveCaptureTarget(undefined, undefined, () => discoverLatestTranscript(cwd, home))).toEqual({
        ok: true,
        sessionId: "real-session",
        transcriptPath: join(dir, "real-session.jsonl"),
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
