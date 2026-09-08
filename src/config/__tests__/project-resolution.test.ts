import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveProject } from "../project-resolution.js";

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function fixture(projects: unknown[]) {
  const base = mkdtempSync(join(tmpdir(), "rekindle-projects-"));
  roots.push(base);
  mkdirSync(join(base, ".rekindle"));
  writeFileSync(join(base, ".rekindle", "projects.json"), JSON.stringify({ schema_version: 1, projects }));
  return base;
}

describe("resolveProject", () => {
  it("resolves exact roots and symlinks through realpath", () => {
    const base = fixture([]);
    const real = join(base, "real");
    const link = join(base, "link");
    mkdirSync(real);
    symlinkSync(real, link);
    writeFileSync(join(base, ".rekindle", "projects.json"), JSON.stringify({ schema_version: 1, projects: [{ name: "P", root: real }] }));
    expect(resolveProject(base, link, undefined)).toMatchObject({ status: "resolved", project: "P", rule: "exact-root" });
  });

  it("inherits from a parent only when declared", () => {
    const base = fixture([]);
    const root = join(base, "project");
    const child = join(root, "src");
    mkdirSync(child, { recursive: true });
    writeFileSync(join(base, ".rekindle", "projects.json"), JSON.stringify({ schema_version: 1, projects: [{ name: "P", root }] }));
    expect(resolveProject(base, child, undefined).status).toBe("unknown");
    writeFileSync(join(base, ".rekindle", "projects.json"), JSON.stringify({ schema_version: 1, projects: [{ name: "P", root, include_descendants: true }] }));
    expect(resolveProject(base, child, undefined)).toMatchObject({ status: "resolved", project: "P", rule: "declared-parent" });
  });

  it("records an explicit override as the winning rule", () => {
    const base = fixture([]);
    expect(resolveProject(base, base, "Override")).toMatchObject({ status: "resolved", project: "Override", rule: "override" });
  });
});
