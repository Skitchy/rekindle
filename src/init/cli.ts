#!/usr/bin/env node

import { homedir } from "node:os";
import { scaffold } from "./scaffold.js";

const args = process.argv.slice(2);
const command = args[0];

if (command === "init") {
  const useGlobal = args.includes("--global");
  const targetDir = useGlobal ? homedir() : process.cwd();

  console.log(
    `Initializing Rekindle in ${useGlobal ? "~/" : "./"} ...`
  );

  scaffold(targetDir);
} else if (command === "help" || command === "--help" || command === "-h") {
  console.log("Rekindle: AI session continuity\n");
  console.log("Usage:");
  console.log("  rekindle init           Set up Rekindle in current directory");
  console.log("  rekindle init --global  Set up Rekindle in home directory");
  console.log("  rekindle               Start MCP server (used by Claude Code)");
} else {
  await import("../index.js");
}
