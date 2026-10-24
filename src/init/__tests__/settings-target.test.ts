import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveSettingsTarget, settingsFileFor } from "../settings-target.js";

describe("settings-target", () => {
  it("project scope targets .claude/settings.local.json under the target directory", () => {
    const t = resolveSettingsTarget("/work/repo", "project");
    expect(t.claudeDir).toBe(join("/work/repo", ".claude"));
    expect(t.settingsPath).toBe(join("/work/repo", ".claude", "settings.local.json"));
    expect(t.displayPath).toBe(".claude/settings.local.json");
  });

  it("user scope targets .claude/settings.json, the file Claude Code applies to every project", () => {
    const t = resolveSettingsTarget("/home/someone", "user");
    expect(t.settingsPath).toBe(join("/home/someone", ".claude", "settings.json"));
    expect(t.settingsPath).not.toContain("settings.local.json");
    expect(t.displayPath).toBe("~/.claude/settings.json");
  });

  it("maps each scope to exactly one settings filename", () => {
    expect(settingsFileFor("project")).toBe("settings.local.json");
    expect(settingsFileFor("user")).toBe("settings.json");
  });
});
