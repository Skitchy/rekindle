import { join } from "node:path";

/**
 * Which Claude Code settings file a hook installer writes.
 *
 * Claude Code reads four settings files (see
 * https://code.claude.com/docs/en/settings, "Settings files and who they affect"):
 * `~/.claude/settings.json` applies to every project on the machine (user scope);
 * `.claude/settings.local.json` applies only to sessions started in that directory
 * (project scope). There is no user-scope `settings.local.json`: writing one under
 * `~/.claude/` produces a file Claude Code ignores outside the home directory.
 *
 * - "project": `<targetDir>/.claude/settings.local.json` (plain `init`, `setup-*`)
 * - "user":    `<targetDir>/.claude/settings.json` (`--global`, targetDir is `~`)
 */
export type HookScope = "project" | "user";

export interface SettingsTarget {
  claudeDir: string;
  settingsPath: string;
  /** Short path for console output: `~/.claude/settings.json` or `.claude/settings.local.json`. */
  displayPath: string;
}

export function settingsFileFor(scope: HookScope): "settings.json" | "settings.local.json" {
  return scope === "user" ? "settings.json" : "settings.local.json";
}

export function resolveSettingsTarget(targetDir: string, scope: HookScope): SettingsTarget {
  const claudeDir = join(targetDir, ".claude");
  const file = settingsFileFor(scope);
  return {
    claudeDir,
    settingsPath: join(claudeDir, file),
    displayPath: scope === "user" ? `~/.claude/${file}` : `.claude/${file}`,
  };
}
