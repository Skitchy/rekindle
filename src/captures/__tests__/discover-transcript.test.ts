import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { claudeProjectKey, discoverLatestTranscript } from "../discover-transcript.js";

describe("claudeProjectKey", () => {
  it("matches the folder names Claude Code writes on disk", () => {
    expect(claudeProjectKey("/Users/me/Desktop/Tessera")).toBe("-Users-me-Desktop-Tessera");
  });

  it("converts underscore, dot and space, not only slash", () => {
    expect(claudeProjectKey("/Users/me/Code_Projects")).toBe("-Users-me-Code-Projects");
    expect(claudeProjectKey("/Users/me/Shop.Solar")).toBe("-Users-me-Shop-Solar");
    expect(claudeProjectKey("/Users/me/My Website")).toBe("-Users-me-My-Website");
  });

  it("does not add a second leading dash", () => {
    expect(claudeProjectKey("/Users/me").startsWith("--")).toBe(false);
  });
});

describe("discoverLatestTranscript", () => {
  let home: string;

  function addTranscript(cwd: string, sessionId: string, mtimeSec: number): string {
    const dir = join(home, ".claude", "projects", claudeProjectKey(cwd));
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${sessionId}.jsonl`);
    writeFileSync(path, "{}\n");
    utimesSync(path, mtimeSec, mtimeSec);
    return path;
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rekindle-discover-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("finds the newest transcript in a project whose path has _ . and space", () => {
    const cwd = "/Users/me/Code_Projects/my.app/Web Build";
    addTranscript(cwd, "older", 1_000);
    const newest = addTranscript(cwd, "newer", 2_000);

    expect(discoverLatestTranscript(cwd, home)).toEqual({
      sessionId: "newer",
      transcriptPath: newest,
    });
  });

  it("returns null instead of another project's transcript when this project has none", () => {
    addTranscript("/Users/me/other-project", "someone-elses-session", 9_000);

    expect(discoverLatestTranscript("/Users/me/this_project", home)).toBeNull();
  });

  it("ignores a newer transcript in another project", () => {
    const cwd = "/Users/me/this_project";
    const mine = addTranscript(cwd, "mine", 1_000);
    addTranscript("/Users/me/other-project", "theirs", 9_000);

    expect(discoverLatestTranscript(cwd, home)?.transcriptPath).toBe(mine);
  });

  it("returns null when the project folder exists but holds no transcript", () => {
    const cwd = "/Users/me/empty";
    mkdirSync(join(home, ".claude", "projects", claudeProjectKey(cwd)), { recursive: true });
    addTranscript("/Users/me/other-project", "theirs", 9_000);

    expect(discoverLatestTranscript(cwd, home)).toBeNull();
  });
});
