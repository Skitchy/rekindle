import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupDelivery } from "../setup-delivery.js";
import { setupHooks } from "../setup-hooks.js";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "rekindle-delivery-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("setupDelivery", () => {
  it("creates a SessionStart group covering all four sources", () => {
    setupDelivery(tmpDir);

    const settingsPath = join(tmpDir, ".claude", "settings.local.json");
    expect(existsSync(settingsPath)).toBe(true);

    const config = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(config.hooks.SessionStart).toHaveLength(1);

    const group = config.hooks.SessionStart[0];
    expect(group.matcher).toBe("startup|resume|clear|compact");
    expect(group.hooks).toHaveLength(1);
    expect(group.hooks[0].type).toBe("command");
    expect(group.hooks[0].command).toBe("npx rekindle session-start");
    expect(group.hooks[0].timeout).toBe(60);
  });

  it("is idempotent on second run", () => {
    setupDelivery(tmpDir);
    setupDelivery(tmpDir);

    const settingsPath = join(tmpDir, ".claude", "settings.local.json");
    const config = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(config.hooks.SessionStart).toHaveLength(1);
    expect(config.hooks.SessionStart[0].hooks).toHaveLength(1);
  });

  it("coexists with the PreCompact capture hook without disturbing it", () => {
    setupHooks(tmpDir);
    setupDelivery(tmpDir);

    const settingsPath = join(tmpDir, ".claude", "settings.local.json");
    const config = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(config.hooks.PreCompact).toHaveLength(2);
    expect(config.hooks.SessionStart).toHaveLength(1);
    expect(config.hooks.PreCompact[0].hooks[0].command).toBe("npx rekindle precompact-capture");
  });

  it("preserves unrelated existing settings and hooks", () => {
    const claudeDir = join(tmpDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "settings.local.json"),
      JSON.stringify({
        theme: "dark",
        hooks: {
          SessionStart: [
            { matcher: "startup", hooks: [{ type: "command", command: "echo other-tool" }] },
          ],
        },
      })
    );

    setupDelivery(tmpDir);

    const config = JSON.parse(readFileSync(join(claudeDir, "settings.local.json"), "utf-8"));
    expect(config.theme).toBe("dark");
    expect(config.hooks.SessionStart).toHaveLength(2);
    expect(config.hooks.SessionStart[0].hooks[0].command).toBe("echo other-tool");
    expect(config.hooks.SessionStart[1].hooks[0].command).toBe("npx rekindle session-start");
  });

  it("refuses to overwrite a corrupted settings file", () => {
    const claudeDir = join(tmpDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "settings.local.json"), "{ not json");

    expect(() => setupDelivery(tmpDir)).toThrow(/invalid JSON/);
    expect(readFileSync(join(claudeDir, "settings.local.json"), "utf-8")).toBe("{ not json");
  });

  it("refuses to overwrite settings whose root is not an object", () => {
    const claudeDir = join(tmpDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "settings.local.json"), JSON.stringify(["array"]));

    expect(() => setupDelivery(tmpDir)).toThrow(/invalid JSON/);
  });
});
