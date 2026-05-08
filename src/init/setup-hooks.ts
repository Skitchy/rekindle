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
    PreCompact?: MatcherGroup[];
    [key: string]: MatcherGroup[] | undefined;
  };
  [key: string]: unknown;
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
  const alreadyInstalled = existing.some((group) =>
    group.hooks?.some((h) => h.command.includes("rekindle precompact-capture"))
  );

  if (alreadyInstalled) {
    console.log("PreCompact hook already configured.");
    return;
  }

  const rekindleHook: CommandHook = {
    type: "command",
    command: hookCommand,
    timeout: 60,
  };

  existing.push(
    { matcher: "auto", hooks: [rekindleHook] },
    { matcher: "manual", hooks: [{ ...rekindleHook }] },
  );
  config.hooks.PreCompact = existing;

  writeFileSync(settingsPath, JSON.stringify(config, null, 2) + "\n");
  console.log("Configured PreCompact hook in .claude/settings.local.json");
}
