import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Where a configured card came from, so a receipt can say which setting won.
 * "unset" means no card is configured and nothing card-related is emitted.
 */
export type UserCardSource = "REKINDLE_USER_CARD" | "policy" | "unset";

/** What happened to the card. Receipts carry this; packets never carry diagnostics. */
export type UserCardStatus = "unset" | "loaded" | "empty" | "missing" | "unreadable" | "too_large";

export interface UserCardRead {
  source: UserCardSource;
  status: UserCardStatus;
  /** Card text, present only when status is "loaded". */
  content?: string;
}

/** Expand a leading "~" and anchor relative paths at the store root. */
export function normalizeCardPath(raw: string, baseDir: string, home: string = homedir()): string {
  let path = raw.trim();
  if (path === "~") path = home;
  else if (path.startsWith("~/")) path = join(home, path.slice(2));
  return isAbsolute(path) ? path : resolve(baseDir, path);
}

/**
 * The one resolver the hook, the MCP server and the CLI share. The env var wins
 * over policy; a blank env var counts as unset. Relative paths resolve against
 * the store root, never the process cwd, so every caller lands on the same file.
 */
export function resolveUserCardPath(
  env: Record<string, string | undefined>,
  policyPath: string | undefined,
  baseDir: string,
  home: string = homedir()
): { path: string | null; source: UserCardSource } {
  const fromEnv = env.REKINDLE_USER_CARD;
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    return { path: normalizeCardPath(fromEnv, baseDir, home), source: "REKINDLE_USER_CARD" };
  }
  if (policyPath !== undefined && policyPath.trim() !== "") {
    return { path: normalizeCardPath(policyPath, baseDir, home), source: "policy" };
  }
  return { path: null, source: "unset" };
}

/** The largest budget policy allows; a card bigger than this can never be delivered. */
export const MAX_CARD_BYTES = 1_000_000;

/**
 * Every card path the store is configured with, env and policy both, so callers
 * that must not write over the card protect the one that is shadowed too.
 */
export function configuredCardPaths(
  env: Record<string, string | undefined>,
  policyPath: string | undefined,
  baseDir: string,
  home: string = homedir()
): string[] {
  const out: string[] = [];
  const fromEnv = env.REKINDLE_USER_CARD;
  if (fromEnv !== undefined && fromEnv.trim() !== "") out.push(normalizeCardPath(fromEnv, baseDir, home));
  if (policyPath !== undefined && policyPath.trim() !== "") out.push(normalizeCardPath(policyPath, baseDir, home));
  return out;
}

/**
 * Read the card without ever throwing or blocking: a card problem must not fail
 * or stall a boot. The file is opened non-blocking and must be a regular file,
 * so a FIFO or device at the configured path is refused instead of waited on.
 * A card larger than maxBytes is not read at all; it could never fit.
 * The path itself is not returned, so nothing downstream can echo it.
 */
export function readUserCard(path: string | null, source: UserCardSource, maxBytes: number = MAX_CARD_BYTES): UserCardRead {
  if (path === null) return { source, status: "unset" };
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { source, status: code === "ENOENT" ? "missing" : "unreadable" };
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return { source, status: "unreadable" };
    if (st.size > maxBytes) return { source, status: "too_large" };
    const buffer = Buffer.alloc(st.size);
    let read = 0;
    while (read < st.size) {
      const n = readSync(fd, buffer, read, st.size - read, read);
      if (n === 0) break;
      read += n;
    }
    const raw = buffer.subarray(0, read).toString("utf-8");
    if (raw.trim().length === 0) return { source, status: "empty" };
    return { source, status: "loaded", content: raw };
  } catch {
    return { source, status: "unreadable" };
  } finally {
    closeSync(fd);
  }
}

/** The packet section for a loaded card. No path, so no absolute path leaks. */
export function renderUserCardSection(content: string): string {
  return `## User Card\n\n${content.trimEnd()}`;
}
