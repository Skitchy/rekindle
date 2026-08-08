#!/usr/bin/env node

import { RekindleStorage } from "./storage/sqlite.js";
import { resolveStorageRoot } from "./storage/root.js";
import { CaptureManager } from "./captures/index.js";
import { startServer } from "./server.js";

const root = resolveStorageRoot();

let storage: RekindleStorage;
try {
  storage = new RekindleStorage(root.dbPath);
} catch (err) {
  console.error(
    `Rekindle: cannot create or open storage at ${root.dbPath}\n` +
      `  (base directory: ${root.baseDir}, resolved via: ${root.baseSource})\n` +
      `If this host spawns MCP servers in an unwritable directory, set ` +
      `REKINDLE_BASE_DIR to a writable location, e.g. your home directory.`
  );
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const captureManager = new CaptureManager(root.baseDir);

startServer(storage, captureManager).catch((err) => {
  console.error("Failed to start Rekindle server:", err);
  process.exit(1);
});
