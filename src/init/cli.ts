#!/usr/bin/env node

import { homedir } from "node:os";
import { scaffold } from "./scaffold.js";
import { setupHooks } from "./setup-hooks.js";
import { setupDelivery } from "./setup-delivery.js";
import type { HookScope } from "./settings-target.js";

const args = process.argv.slice(2);
const command = args[0];

// --global targets the home directory. Hooks then go to the user-scope settings
// file (~/.claude/settings.json), which Claude Code applies in every project;
// without --global they go to the project-local .claude/settings.local.json.
const useGlobal = args.includes("--global");
const targetDir = useGlobal ? homedir() : process.cwd();
const scope: HookScope = useGlobal ? "user" : "project";

if (command === "init") {
  const withHooks = args.includes("--with-hooks");
  const withDelivery = args.includes("--with-delivery");

  console.log(
    `Initializing Rekindle in ${useGlobal ? "~/" : "./"} ...`
  );

  scaffold(targetDir, scope);

  if (withHooks) {
    setupHooks(targetDir, scope);
  }
  if (withDelivery) {
    setupDelivery(targetDir, scope);
  }

  const cardFlag = args.indexOf("--card");
  if (cardFlag !== -1) {
    const file = args[cardFlag + 1];
    const { setCardPath } = await import("../card/path-config.js");
    try {
      if (file === undefined || file.startsWith("--")) throw new Error("--card needs a file name: rekindle init --card <file>");
      const stored = setCardPath(targetDir, file);
      console.log(`User card: this store loads ${stored} at startup.`);
    } catch (err) {
      console.error(`User card not set: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  } else {
    console.log("Optional: give agents a user card. Start one with `rekindle card template <file>`,");
    console.log("or draft one from what your agent already knows with `rekindle card compile --out <dir>`.");
  }
} else if (command === "card") {
  const { runCardCommand } = await import("../card/cli.js");
  process.exitCode = runCardCommand(args.slice(1));
} else if (command === "setup-hooks") {
  setupHooks(targetDir, scope);
} else if (command === "setup-delivery") {
  setupDelivery(targetDir, scope);
} else if (command === "session-start") {
  const clientFlag = args.indexOf("--client");
  const client = clientFlag !== -1 ? args[clientFlag + 1] : "claude-code";
  if (client === "cursor") {
    const { main } = await import("../delivery/cursor.js");
    await main();
  } else {
    const { main } = await import("../delivery/session-start.js");
    await main();
  }
} else if (command === "precompact-capture") {
  await import("../captures/precompact-capture.js");
} else if (command === "capture-now") {
  await import("../captures/capture-now.js");
} else if (command === "help" || command === "--help" || command === "-h") {
  console.log("Rekindle: AI session continuity\n");
  console.log("Usage:");
  console.log("  rekindle init                Set up Rekindle in current directory");
  console.log("  rekindle init --global       Set up Rekindle in home directory (hooks go to ~/.claude/settings.json)");
  console.log("  rekindle init --with-hooks   Set up Rekindle and configure PreCompact capture hook");
  console.log("  rekindle init --with-delivery");
  console.log("                               Set up Rekindle and configure SessionStart delivery hook");
  console.log("                               (orientation packet at startup/resume/clear/compact; opt-in)");
  console.log("  rekindle setup-hooks         Configure PreCompact capture hook (standalone)");
  console.log("  rekindle setup-delivery      Configure SessionStart delivery hook (standalone)");
  console.log("  rekindle session-start       Emit budgeted orientation packet (SessionStart hook)");
  console.log("  rekindle session-start --client cursor");
  console.log("                               Same, in Cursor's hook response shape (privacy-safe: stdin email/paths never persisted)");
  console.log("  rekindle precompact-capture  Capture context before compaction (hook)");
  console.log("  rekindle capture-now         Manually capture current session context");
  console.log("  rekindle init --card <file>  Also load <file> as the user card at startup");
  console.log("  rekindle card                User card commands: template, path, compile (see rekindle card help)");
  console.log("  rekindle                     Start MCP server (used by Claude Code)");
} else {
  await import("../index.js");
}
