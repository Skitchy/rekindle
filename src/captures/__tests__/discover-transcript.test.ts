import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { claudeProjectKey, discoverLatestTranscript, sessionIdFromFileName } from "../discover-transcript.js";

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

  // A synthetic transcript that records its own cwd, the way Claude Code's do.
  function addTranscript(cwd: string, sessionId: string, mtimeSec: number, recordedCwd: string | null = cwd): string {
    const dir = join(home, ".claude", "projects", claudeProjectKey(cwd));
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${sessionId}.jsonl`);
    const lines = ['{"type":"summary"}'];
    if (recordedCwd !== null) lines.push(JSON.stringify({ type: "user", cwd: recordedCwd, sessionId }));
    writeFileSync(path, lines.join("\n") + "\n");
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

  it("does not return a transcript from a different workspace whose folder name collides", () => {
    // "client_a" and "client-a" map to the same Claude Code folder.
    expect(claudeProjectKey("/projects/client_a")).toBe(claudeProjectKey("/projects/client-a"));
    addTranscript("/projects/client_a", "a-session", 5_000);
    expect(discoverLatestTranscript("/projects/client-a", home)).toBeNull();
    expect(discoverLatestTranscript("/projects/client_a", home)?.sessionId).toBe("a-session");
  });

  it("picks this workspace's transcript over a newer colliding one", () => {
    const mine = addTranscript("/projects/client-a", "b-session", 1_000);
    addTranscript("/projects/client_a", "a-session", 9_000);
    expect(discoverLatestTranscript("/projects/client-a", home)?.transcriptPath).toBe(mine);
  });

  it("refuses a transcript whose owner cannot be established", () => {
    addTranscript("/projects/no-cwd", "unknown-owner", 1_000, null);
    expect(discoverLatestTranscript("/projects/no-cwd", home)).toBeNull();
  });

  it("skips a newer directory or FIFO named *.jsonl and still finds the owned regular file", () => {
    const cwd = "/projects/odd-entries";
    const mine = addTranscript(cwd, "older", 1_000);
    const dir = join(home, ".claude", "projects", claudeProjectKey(cwd));
    mkdirSync(join(dir, "newer.jsonl"));
    execFileSync("mkfifo", [join(dir, "pipe.jsonl")]);
    const started = Date.now();
    expect(discoverLatestTranscript(cwd, home)?.transcriptPath).toBe(mine);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("treats an unreadable candidate as unusable and moves on", () => {
    const cwd = "/projects/locked";
    const mine = addTranscript(cwd, "readable", 1_000);
    const locked = addTranscript(cwd, "locked", 9_000);
    chmodSync(locked, 0o000);
    try {
      expect(discoverLatestTranscript(cwd, home)?.transcriptPath).toBe(mine);
    } finally {
      chmodSync(locked, 0o600);
    }
  });

  it("never returns a blank or hidden session id", () => {
    const cwd = "/projects/names";
    const dir = join(home, ".claude", "projects", claudeProjectKey(cwd));
    mkdirSync(dir, { recursive: true });
    for (const name of [".jsonl", " .jsonl", ".hidden.jsonl"]) {
      writeFileSync(join(dir, name), JSON.stringify({ cwd }) + "\n");
    }
    expect(discoverLatestTranscript(cwd, home)).toBeNull();
    expect(sessionIdFromFileName("abc.jsonl")).toBe("abc");
    expect(sessionIdFromFileName(".jsonl")).toBeNull();
  });

  it("returns null when the project folder exists but holds no transcript", () => {
    const cwd = "/Users/me/empty";
    mkdirSync(join(home, ".claude", "projects", claudeProjectKey(cwd)), { recursive: true });
    addTranscript("/Users/me/other-project", "theirs", 9_000);

    expect(discoverLatestTranscript(cwd, home)).toBeNull();
  });
});
