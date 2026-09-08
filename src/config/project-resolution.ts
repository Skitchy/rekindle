import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

export interface ProjectEntry {
  name: string;
  root: string;
  include_descendants?: boolean;
}

export interface ProjectResolution {
  status: "resolved" | "unknown" | "ambiguous";
  project: string | null;
  rule: "override" | "exact-root" | "declared-parent" | "unknown" | "ambiguous";
  cwd: string | null;
  registry_path: string;
  override_registered: boolean | null;
}

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  return existsSync(absolute) ? realpathSync.native(absolute) : absolute;
}

export function resolveProject(baseDir: string, cwd: string | undefined, override: string | undefined): ProjectResolution {
  const registryPath = join(baseDir, ".rekindle", "projects.json");
  if (override?.trim()) {
    let registered = false;
    if (existsSync(registryPath)) {
      const parsed = JSON.parse(readFileSync(registryPath, "utf-8")) as { schema_version?: number; projects?: ProjectEntry[] };
      if (parsed.schema_version !== 1 || !Array.isArray(parsed.projects)) throw new Error("invalid projects registry");
      registered = parsed.projects.some((entry) => entry?.name === override.trim());
    }
    return { status: "resolved", project: override.trim(), rule: "override", cwd: cwd ? canonicalPath(cwd) : null, registry_path: registryPath, override_registered: registered };
  }
  if (!cwd) return { status: "unknown", project: null, rule: "unknown", cwd: null, registry_path: registryPath, override_registered: null };
  const realCwd = canonicalPath(cwd);
  if (!existsSync(registryPath)) return { status: "unknown", project: null, rule: "unknown", cwd: realCwd, registry_path: registryPath, override_registered: null };
  const parsed = JSON.parse(readFileSync(registryPath, "utf-8")) as { schema_version?: number; projects?: ProjectEntry[] };
  if (parsed.schema_version !== 1 || !Array.isArray(parsed.projects)) throw new Error("invalid projects registry");
  const registryDir = dirname(registryPath);
  const entries = parsed.projects.map((entry) => {
    if (!entry || typeof entry.name !== "string" || !entry.name.trim() || typeof entry.root !== "string") throw new Error("invalid project registry entry");
    const root = canonicalPath(isAbsolute(entry.root) ? entry.root : resolve(registryDir, entry.root));
    return { ...entry, name: entry.name.trim(), root };
  });
  const exact = entries.filter((entry) => entry.root === realCwd);
  if (exact.length === 1) return { status: "resolved", project: exact[0].name, rule: "exact-root", cwd: realCwd, registry_path: registryPath, override_registered: null };
  if (exact.length > 1) return { status: "ambiguous", project: null, rule: "ambiguous", cwd: realCwd, registry_path: registryPath, override_registered: null };
  const parents = entries.filter((entry) => entry.include_descendants === true && realCwd.startsWith(entry.root.endsWith(sep) ? entry.root : entry.root + sep));
  if (parents.length === 0) return { status: "unknown", project: null, rule: "unknown", cwd: realCwd, registry_path: registryPath, override_registered: null };
  const longest = Math.max(...parents.map((entry) => entry.root.length));
  const winners = parents.filter((entry) => entry.root.length === longest);
  if (winners.length !== 1) return { status: "ambiguous", project: null, rule: "ambiguous", cwd: realCwd, registry_path: registryPath, override_registered: null };
  return { status: "resolved", project: winners[0].name, rule: "declared-parent", cwd: realCwd, registry_path: registryPath, override_registered: null };
}
