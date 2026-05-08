import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupHooks } from "../setup-hooks.js";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "rekindle-hooks-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("setupHooks", () => {
  it("creates auto and manual matcher groups for PreCompact", () => {
    setupHooks(tmpDir);

    const settingsPath = join(tmpDir, ".claude", "settings.local.json");
    expect(existsSync(settingsPath)).toBe(true);

    const config = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(config.hooks).toBeDefined();
    expect(config.hooks.PreCompact).toHaveLength(2);

    const autoGroup = config.hooks.PreCompact[0];
    expect(autoGroup.matcher).toBe("auto");
    expect(autoGroup.hooks).toHaveLength(1);
    expect(autoGroup.hooks[0].type).toBe("command");
    expect(autoGroup.hooks[0].command).toBe("npx rekindle precompact-capture");
    expect(autoGroup.hooks[0].timeout).toBe(60);

    const manualGroup = config.hooks.PreCompact[1];
    expect(manualGroup.matcher).toBe("manual");
    expect(manualGroup.hooks[0].command).toBe("npx rekindle precompact-capture");
  });

  it("is idempotent — does not duplicate on second run", () => {
    setupHooks(tmpDir);
    setupHooks(tmpDir);

    const settingsPath = join(tmpDir, ".claude", "settings.local.json");
    const config = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(config.hooks.PreCompact).toHaveLength(2);
  });

  it("preserves existing settings", () => {
    const claudeDir = join(tmpDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, "settings.local.json");
    writeFileSync(settingsPath, JSON.stringify({
      permissions: { allow: ["Read"] },
      hooks: {
        PostCompact: [{ matcher: "auto", hooks: [{ type: "command", command: "echo done" }] }],
      },
    }, null, 2));

    setupHooks(tmpDir);

    const config = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(config.permissions.allow).toEqual(["Read"]);
    expect(config.hooks.PostCompact).toHaveLength(1);
    expect(config.hooks.PreCompact).toHaveLength(2);
  });

  it("appends to existing PreCompact hooks without removing them", () => {
    const claudeDir = join(tmpDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, "settings.local.json");
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PreCompact: [{ matcher: "auto", hooks: [{ type: "command", command: "echo pre-existing" }] }],
      },
    }, null, 2));

    setupHooks(tmpDir);

    const config = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(config.hooks.PreCompact).toHaveLength(3);
    expect(config.hooks.PreCompact[0].hooks[0].command).toBe("echo pre-existing");
    expect(config.hooks.PreCompact[1].matcher).toBe("auto");
    expect(config.hooks.PreCompact[1].hooks[0].command).toBe("npx rekindle precompact-capture");
    expect(config.hooks.PreCompact[2].matcher).toBe("manual");
  });

  it("handles corrupted settings file gracefully", () => {
    const claudeDir = join(tmpDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "settings.local.json"), "not json {{{");

    setupHooks(tmpDir);

    const config = JSON.parse(readFileSync(join(claudeDir, "settings.local.json"), "utf-8"));
    expect(config.hooks.PreCompact).toHaveLength(2);
    expect(config.hooks.PreCompact[0].matcher).toBe("auto");
    expect(config.hooks.PreCompact[1].matcher).toBe("manual");
  });
});
