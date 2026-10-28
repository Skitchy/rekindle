import { join } from "node:path";
import { closeSync, constants, existsSync, fstatSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";

// Claude Code names a project's transcript folder after its working directory,
// with every character that is not a letter or digit replaced by "-".
// "/Users/me/Code_Projects/my.app" becomes "-Users-me-Code-Projects-my-app".
// The mapping is lossy ("client_a" and "client-a" share a folder), so the
// folder alone never proves which workspace a transcript belongs to.
export function claudeProjectKey(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

const OWNERSHIP_SCAN_BYTES = 256 * 1024;

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * The working directory a transcript records for itself: the first entry that
 * carries a string `cwd`. Only the head of the file is read. Returns null when
 * no such entry is found, in which case ownership cannot be established.
 */
export function transcriptCwd(path: string): string | null {
  // Non-blocking, so a FIFO named *.jsonl can't stall discovery; then only a
  // regular file counts. Any failure makes the candidate unusable, not fatal.
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    if (!fstatSync(fd).isFile()) return null;
    const buffer = Buffer.alloc(OWNERSHIP_SCAN_BYTES);
    const n = readSync(fd, buffer, 0, buffer.length, 0);
    const lines = buffer.subarray(0, n).toString("utf-8").split("\n");
    if (n === buffer.length) lines.pop(); // the last line may be cut off
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as { cwd?: unknown };
        if (typeof entry.cwd === "string") return entry.cwd;
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** A transcript file name that yields a usable session id: "<id>.jsonl", id not blank or hidden. */
export function sessionIdFromFileName(name: string): string | null {
  if (!name.endsWith(".jsonl")) return null;
  const id = name.slice(0, -".jsonl".length).trim();
  return id && !id.startsWith(".") ? id : null;
}

// Returns the newest transcript in the current project's folder that records
// this same working directory. It never looks in another project's folder, and
// it skips transcripts from a different workspace that shares the folder name.
// If nothing can be shown to belong here, it returns null and the caller asks
// for an explicit path.
export function discoverLatestTranscript(
  cwd: string = process.cwd(),
  home: string = homedir(),
): { sessionId: string; transcriptPath: string } | null {
  const projectDir = join(home, ".claude", "projects", claudeProjectKey(cwd));
  if (!existsSync(projectDir)) return null;

  const want = canonical(cwd);
  const candidates: Array<{ sessionId: string; path: string; mtime: number }> = [];
  for (const name of readdirSync(projectDir)) {
    const sessionId = sessionIdFromFileName(name);
    if (sessionId === null) continue;
    const path = join(projectDir, name);
    try {
      candidates.push({ sessionId, path, mtime: statSync(path).mtimeMs });
    } catch {
      continue; // vanished or unreadable: not a candidate
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);

  for (const candidate of candidates) {
    const recorded = transcriptCwd(candidate.path);
    if (recorded !== null && canonical(recorded) === want) {
      return { sessionId: candidate.sessionId, transcriptPath: candidate.path };
    }
  }
  return null;
}
