#!/usr/bin/env node

import { homedir } from "node:os";
import { scaffold } from "./scaffold.js";
import { setupHooks } from "./setup-hooks.js";

const args = process.argv.slice(2);
const command = args[0];

if (command === "init") {
  const useGlobal = args.includes("--global");
  const withHooks = args.includes("--with-hooks");
  const targetDir = useGlobal ? homedir() : process.cwd();

  console.log(
    `Initializing Rekindle in ${useGlobal ? "~/" : "./"} ...`
  );

  scaffold(targetDir);

  if (withHooks) {
    setupHooks(targetDir);
  }
} else if (command === "setup-hooks") {
  const useGlobal = args.includes("--global");
  const targetDir = useGlobal ? homedir() : process.cwd();
  setupHooks(targetDir);
} else if (command === "session-start") {
  const { main } = await import("../delivery/session-start.js");
  await main();
} else if (command === "precompact-capture") {
  await import("../captures/precompact-capture.js");
} else if (command === "capture-now") {
  await import("../captures/capture-now.js");
} else if (command === "help" || command === "--help" || command === "-h") {
  console.log("Rekindle: AI session continuity\n");
  console.log("Usage:");
  console.log("  rekindle init                Set up Rekindle in current directory");
  console.log("  rekindle init --global       Set up Rekindle in home directory");
  console.log("  rekindle init --with-hooks   Set up Rekindle and configure PreCompact hook");
  console.log("  rekindle setup-hooks         Configure PreCompact hook (standalone)");
  console.log("  rekindle session-start       Emit budgeted orientation packet (SessionStart hook)");
  console.log("  rekindle precompact-capture  Capture context before compaction (hook)");
  console.log("  rekindle capture-now         Manually capture current session context");
  console.log("  rekindle                     Start MCP server (used by Claude Code)");
} else {
  await import("../index.js");
}
