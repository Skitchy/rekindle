import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface CommandHook {
  type: "command";
  command: string;
  timeout?: number;
}

interface MatcherGroup {
  matcher: string;
  hooks: CommandHook[];
}

interface HooksConfig {
  hooks?: {
    SessionStart?: MatcherGroup[];
    [key: string]: MatcherGroup[] | undefined;
  };
  [key: string]: unknown;
}

export function setupDelivery(targetDir: string): void {
  const claudeDir = join(targetDir, ".claude");
  const settingsPath = join(claudeDir, "settings.local.json");

  mkdirSync(claudeDir, { recursive: true });

  const hookCommand = "npx rekindle session-start";

  let config: HooksConfig = {};
  if (existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, "utf-8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("settings root must be a JSON object");
      }
      config = parsed as HooksConfig;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Refusing to modify ${settingsPath}: existing settings are invalid JSON (${detail}). Fix the file and run setup-delivery again.`
      );
    }
  }

  if (!config.hooks) {
    config.hooks = {};
  }

  const existing = config.hooks.SessionStart ?? [];
  const alreadyInstalled = existing.some((group) =>
    group.hooks?.some((h) => h.command.includes("rekindle session-start"))
  );

  if (alreadyInstalled) {
    console.log("SessionStart delivery hook already configured.");
    return;
  }

  existing.push({
    matcher: "startup|resume|clear|compact",
    hooks: [{ type: "command", command: hookCommand, timeout: 60 }],
  });
  config.hooks.SessionStart = existing;

  writeFileSync(settingsPath, JSON.stringify(config, null, 2) + "\n");
  console.log("Configured SessionStart delivery hook in .claude/settings.local.json");
}
