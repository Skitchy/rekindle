import { describe, it, expect } from "vitest";
import { join, parse } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { resolveStorageRoot, baseDirFromDbPath } from "../root.js";

const FS_ROOT = parse(tmpdir()).root;

function tempDir(withRekindle: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "rekindle-root-test-"));
  if (withRekindle) mkdirSync(join(dir, ".rekindle"));
  return dir;
}

describe("resolveStorageRoot", () => {
  it("REKINDLE_BASE_DIR wins over everything", () => {
    const cwd = tempDir(true);
    const home = tempDir(true);
    try {
      const root = resolveStorageRoot({
        cwd,
        home,
        env: { REKINDLE_BASE_DIR: "/explicit/base" },
      });
      expect(root.baseDir).toBe("/explicit/base");
      expect(root.baseSource).toBe("REKINDLE_BASE_DIR");
      expect(root.dbPath).toBe(
        join("/explicit/base", ".rekindle", "db", "memories.db")
      );
    } finally {
      rmSync(cwd, { recursive: true });
      rmSync(home, { recursive: true });
    }
  });

  it("derives baseDir from a canonical REKINDLE_DB_PATH so db and captures stay together", () => {
    const dbPath = join("/some/project", ".rekindle", "db", "memories.db");
    const root = resolveStorageRoot({
      cwd: "/elsewhere",
      home: "/home/nobody",
      env: { REKINDLE_DB_PATH: dbPath },
      exists: () => false,
    });
    expect(root.baseDir).toBe("/some/project");
    expect(root.baseSource).toBe("REKINDLE_DB_PATH");
    expect(root.dbPath).toBe(dbPath);
    expect(root.dbSource).toBe("REKINDLE_DB_PATH");
  });

  it("honors a non-canonical REKINDLE_DB_PATH but resolves baseDir independently", () => {
    const home = tempDir(false);
    try {
      const root = resolveStorageRoot({
        cwd: home, // no .rekindle here
        home,
        env: { REKINDLE_DB_PATH: "/tmp/custom.db" },
      });
      expect(root.dbPath).toBe("/tmp/custom.db");
      expect(root.baseDir).toBe(home);
      expect(root.baseSource).toBe("default-home");
    } finally {
      rmSync(home, { recursive: true });
    }
  });

  it("prefers a project .rekindle in cwd", () => {
    const cwd = tempDir(true);
    const home = tempDir(true);
    try {
      const root = resolveStorageRoot({ cwd, home, env: {} });
      expect(root.baseDir).toBe(cwd);
      expect(root.baseSource).toBe("project");
    } finally {
      rmSync(cwd, { recursive: true });
      rmSync(home, { recursive: true });
    }
  });

  it("falls back to home when only home has .rekindle", () => {
    const cwd = tempDir(false);
    const home = tempDir(true);
    try {
      const root = resolveStorageRoot({ cwd, home, env: {} });
      expect(root.baseDir).toBe(home);
      expect(root.baseSource).toBe("home");
    } finally {
      rmSync(cwd, { recursive: true });
      rmSync(home, { recursive: true });
    }
  });

  it("defaults to home, never cwd, when nothing exists (the Desktop crash class)", () => {
    const cwd = tempDir(false);
    const home = tempDir(false);
    try {
      const root = resolveStorageRoot({ cwd, home, env: {} });
      expect(root.baseDir).toBe(home);
      expect(root.baseSource).toBe("default-home");
    } finally {
      rmSync(cwd, { recursive: true });
      rmSync(home, { recursive: true });
    }
  });

  it("never auto-selects the filesystem root as a project store, even if /.rekindle exists", () => {
    const home = tempDir(false);
    try {
      const root = resolveStorageRoot({
        cwd: FS_ROOT, // exactly how Desktop spawns MCP servers
        home,
        env: {},
        exists: (p) => p === join(FS_ROOT, ".rekindle"), // simulate /.rekindle existing
      });
      expect(root.baseDir).toBe(home);
      expect(root.baseSource).toBe("default-home");
    } finally {
      rmSync(home, { recursive: true });
    }
  });
});

describe("baseDirFromDbPath", () => {
  it("extracts base from canonical layout", () => {
    expect(
      baseDirFromDbPath(join("/a/b", ".rekindle", "db", "memories.db"))
    ).toBe("/a/b");
  });

  it("returns null for non-canonical layouts", () => {
    expect(baseDirFromDbPath("/tmp/custom.db")).toBeNull();
    expect(baseDirFromDbPath(join("/a/b", "db", "memories.db"))).toBeNull();
  });
});
