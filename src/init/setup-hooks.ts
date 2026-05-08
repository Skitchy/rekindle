import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface HookEntry {
  type: "command";
  command: string;
  timeout?: number;
}

interface HooksConfig {
  hooks?: {
    PreCompact?: HookEntry[];
    [key: string]: HookEntry[] | undefined;
  };
}

export function setupHooks(targetDir: string): void {
  const claudeDir = join(targetDir, ".claude");
  const settingsPath = join(claudeDir, "settings.local.json");

  mkdirSync(claudeDir, { recursive: true });

  const hookCommand = "npx rekindle precompact-capture";

  let config: HooksConfig = {};
  if (existsSync(settingsPath)) {
    try {
      config = JSON.parse(readFileSync(settingsPath, "utf-8")) as HooksConfig;
    } catch {
      config = {};
    }
  }

  if (!config.hooks) {
    config.hooks = {};
  }

  const existing = config.hooks.PreCompact ?? [];
  const alreadyInstalled = existing.some(
    (h) => h.type === "command" && h.command.includes("rekindle precompact-capture")
  );

  if (alreadyInstalled) {
    console.log("PreCompact hook already configured.");
    return;
  }

  existing.push({
    type: "command",
    command: hookCommand,
    timeout: 60000,
  });
  config.hooks.PreCompact = existing;

  writeFileSync(settingsPath, JSON.stringify(config, null, 2) + "\n");
  console.log("Configured PreCompact hook in .claude/settings.local.json");
}
