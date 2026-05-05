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
} else {
  console.log("Rekindle: AI relationship persistence\n");
  console.log("Usage:");
  console.log("  npx rekindle init           Set up Rekindle in current directory");
  console.log("  npx rekindle init --global  Set up Rekindle in home directory");
}
