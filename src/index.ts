#!/usr/bin/env node

import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { RekindleStorage } from "./storage/sqlite.js";
import { startServer } from "./server.js";

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

startServer(storage).catch((err) => {
  console.error("Failed to start Rekindle server:", err);
  process.exit(1);
});
