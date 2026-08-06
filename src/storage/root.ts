import { join, dirname, basename, parse } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

export type BaseDirSource =
  | "REKINDLE_BASE_DIR"
  | "REKINDLE_DB_PATH"
  | "project"
  | "home"
  | "default-home";

export interface StorageRoot {
  /** Directory that contains (or will contain) `.rekindle/` */
  baseDir: string;
  /** Full path to the SQLite database file */
  dbPath: string;
  baseSource: BaseDirSource;
  dbSource: "REKINDLE_DB_PATH" | "derived";
}

export interface ResolveOptions {
  cwd?: string;
  home?: string;
  env?: Record<string, string | undefined>;
  /** Injectable for tests; defaults to fs.existsSync */
  exists?: (path: string) => boolean;
}

function isFsRoot(dir: string): boolean {
  return parse(dir).root === dir;
}

function dbPathFor(baseDir: string): string {
  return join(baseDir, ".rekindle", "db", "memories.db");
}

/**
 * If dbPath follows the canonical `<base>/.rekindle/db/<file>` layout,
 * return `<base>`; otherwise null.
 */
export function baseDirFromDbPath(dbPath: string): string | null {
  const rekindleDir = dirname(dirname(dbPath));
  return basename(rekindleDir) === ".rekindle" ? dirname(rekindleDir) : null;
}

/**
 * Single authority for where Rekindle's storage lives.
 *
 * Resolution order for the base directory:
 *   1. REKINDLE_BASE_DIR (explicit always wins)
 *   2. Derived from REKINDLE_DB_PATH when it follows the canonical layout
 *   3. `.rekindle/` in cwd — only when cwd is not the filesystem root
 *   4. `.rekindle/` in the home directory
 *   5. Default: the home directory. Never cwd.
 *
 * Rule 3's root-guard and rule 5 exist for hosts (e.g. Claude Desktop) that
 * spawn MCP servers at cwd=/ — a spawn point is not a storage location.
 */
export function resolveStorageRoot(opts: ResolveOptions = {}): StorageRoot {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? homedir();
  const exists = opts.exists ?? existsSync;

  const explicitDb = env.REKINDLE_DB_PATH;
  const dbSource = explicitDb ? "REKINDLE_DB_PATH" : "derived";

  const finish = (baseDir: string, baseSource: BaseDirSource): StorageRoot => ({
    baseDir,
    dbPath: explicitDb ?? dbPathFor(baseDir),
    baseSource,
    dbSource,
  });

  if (env.REKINDLE_BASE_DIR) {
    return finish(env.REKINDLE_BASE_DIR, "REKINDLE_BASE_DIR");
  }
  if (explicitDb) {
    const derived = baseDirFromDbPath(explicitDb);
    if (derived) return finish(derived, "REKINDLE_DB_PATH");
  }
  if (!isFsRoot(cwd) && exists(join(cwd, ".rekindle"))) {
    return finish(cwd, "project");
  }
  if (exists(join(home, ".rekindle"))) {
    return finish(home, "home");
  }
  return finish(home, "default-home");
}
