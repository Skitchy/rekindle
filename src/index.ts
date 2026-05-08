#!/usr/bin/env node

import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { RekindleStorage } from "./storage/sqlite.js";
import { CaptureManager } from "./captures/index.js";
import { startServer } from "./server.js";

function findBaseDir(): string {
  if (existsSync(join(process.cwd(), ".rekindle"))) {
    return process.cwd();
  }
  if (existsSync(join(homedir(), ".rekindle"))) {
    return homedir();
  }
  return process.cwd();
}

function findDbPath(): string {
  const localPath = join(process.cwd(), ".rekindle", "db", "memories.db");
  if (existsSync(join(process.cwd(), ".rekindle"))) {
    return localPath;
  }

  const globalPath = join(homedir(), ".rekindle", "db", "memories.db");
  if (existsSync(join(homedir(), ".rekindle"))) {
    return globalPath;
  }

  return localPath;
}

const dbPath = process.env.REKINDLE_DB_PATH || findDbPath();
const storage = new RekindleStorage(dbPath);
const baseDir = process.env.REKINDLE_BASE_DIR || findBaseDir();
const captureManager = new CaptureManager(baseDir);

startServer(storage, captureManager).catch((err) => {
  console.error("Failed to start Rekindle server:", err);
  process.exit(1);
});
