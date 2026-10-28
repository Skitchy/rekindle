import { join } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";

// Claude Code names a project's transcript folder after its working directory,
// with every character that is not a letter or digit replaced by "-".
// "/Users/me/Code_Projects/my.app" becomes "-Users-me-Code-Projects-my-app".
export function claudeProjectKey(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

// Returns the newest transcript in the current project's folder only.
// It never looks in another project's folder: if this project has no
// transcript, it returns null and the caller asks for an explicit path.
export function discoverLatestTranscript(
  cwd: string = process.cwd(),
  home: string = homedir(),
): { sessionId: string; transcriptPath: string } | null {
  const projectDir = join(home, ".claude", "projects", claudeProjectKey(cwd));
  if (!existsSync(projectDir)) return null;

  const jsonls = readdirSync(projectDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({
      name: f,
      path: join(projectDir, f),
      mtime: statSync(join(projectDir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (jsonls.length === 0) return null;

  return {
    sessionId: jsonls[0].name.replace(".jsonl", ""),
    transcriptPath: jsonls[0].path,
  };
}
