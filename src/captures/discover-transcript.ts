import { join } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";

export function discoverLatestTranscript(): { sessionId: string; transcriptPath: string } | null {
  const cwd = process.cwd();
  const cwdKey = "-" + cwd.replace(/\//g, "-");
  const projectDir = join(homedir(), ".claude", "projects", cwdKey);

  if (existsSync(projectDir)) {
    const jsonls = readdirSync(projectDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({
        name: f,
        path: join(projectDir, f),
        mtime: statSync(join(projectDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (jsonls.length > 0) {
      return {
        sessionId: jsonls[0].name.replace(".jsonl", ""),
        transcriptPath: jsonls[0].path,
      };
    }
  }

  const projectsDir = join(homedir(), ".claude", "projects");
  if (existsSync(projectsDir)) {
    let newest: { name: string; path: string; mtime: number } | null = null;

    for (const dir of readdirSync(projectsDir)) {
      const dirPath = join(projectsDir, dir);
      try {
        const files = readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"));
        for (const f of files) {
          const fullPath = join(dirPath, f);
          const mtime = statSync(fullPath).mtimeMs;
          if (!newest || mtime > newest.mtime) {
            newest = { name: f, path: fullPath, mtime };
          }
        }
      } catch {
        continue;
      }
    }

    if (newest) {
      return {
        sessionId: newest.name.replace(".jsonl", ""),
        transcriptPath: newest.path,
      };
    }
  }

  return null;
}
