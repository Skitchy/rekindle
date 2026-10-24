// End-to-end check for issue #25: `--global` must write hooks to the user-scope
// settings file (~/.claude/settings.json), not to ~/.claude/settings.local.json,
// which Claude Code reads only for sessions started in the home directory.
// Runs the real CLI entry point with HOME pointed at a temp directory.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const repoRoot = join(__dirname, "..", "..", "..");
const tsx = join(repoRoot, "node_modules", ".bin", "tsx");
const cli = join(repoRoot, "src", "init", "cli.ts");

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rekindle-cli-global-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function run(...args: string[]): string {
  return execFileSync(tsx, [cli, ...args], {
    cwd: home,
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf-8",
    timeout: 60_000,
  });
}

describe("rekindle CLI --global", () => {
  it("setup-hooks --global writes ~/.claude/settings.json and says so", () => {
    const out = run("setup-hooks", "--global");

    const userSettings = join(home, ".claude", "settings.json");
    expect(existsSync(userSettings)).toBe(true);
    expect(existsSync(join(home, ".claude", "settings.local.json"))).toBe(false);

    const config = JSON.parse(readFileSync(userSettings, "utf-8"));
    expect(config.hooks.PreCompact).toHaveLength(2);
    expect(config.hooks.PreCompact[0].hooks[0].command).toBe("npx rekindle precompact-capture");
    expect(out).toContain("Configured PreCompact hook in ~/.claude/settings.json");
  });

  it("setup-delivery --global writes ~/.claude/settings.json and says so", () => {
    const out = run("setup-delivery", "--global");

    const userSettings = join(home, ".claude", "settings.json");
    expect(existsSync(userSettings)).toBe(true);
    expect(existsSync(join(home, ".claude", "settings.local.json"))).toBe(false);

    const config = JSON.parse(readFileSync(userSettings, "utf-8"));
    expect(config.hooks.SessionStart).toHaveLength(1);
    expect(config.hooks.SessionStart[0].hooks[0].command).toBe("npx rekindle session-start");
    expect(out).toContain("Configured SessionStart delivery hook in ~/.claude/settings.json");
  });

  it("init --global --with-hooks --with-delivery puts both hooks in one user-scope file", () => {
    const out = run("init", "--global", "--with-hooks", "--with-delivery");

    const config = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf-8"));
    expect(config.hooks.PreCompact).toHaveLength(2);
    expect(config.hooks.SessionStart).toHaveLength(1);
    expect(existsSync(join(home, ".claude", "settings.local.json"))).toBe(false);

    // Init output names the paths it actually wrote and the README's commands.
    expect(existsSync(join(home, ".rekindle", "identity.md"))).toBe(true);
    expect(out).toContain("Created identity template: ~/.rekindle/identity.md");
    expect(out).toContain("Fill in ~/.rekindle/identity.md");
    expect(out).toContain("npx rekindle setup-delivery --global");
    expect(out).toContain("npx rekindle setup-hooks --global");
    expect(out).not.toContain("Created identity template: .rekindle/identity.md");
  });

  it("without --global, setup-hooks stays project-local and init prints relative paths", () => {
    const out = run("init", "--with-hooks");

    expect(existsSync(join(home, ".claude", "settings.local.json"))).toBe(true);
    expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false);
    expect(out).toContain("Configured PreCompact hook in .claude/settings.local.json");
    expect(out).toContain("Created identity template: .rekindle/identity.md");
    expect(out).toContain("npx rekindle setup-delivery\n");
    expect(out).toContain("Register the MCP server with Claude Code:");
  });
});
