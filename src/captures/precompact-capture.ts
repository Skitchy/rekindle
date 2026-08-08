#!/usr/bin/env node

import { CaptureManager } from "./CaptureManager.js";
import { resolveStorageRoot } from "../storage/root.js";
import type { HookInput } from "./types.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function main(): Promise<void> {
  let input: HookInput;

  try {
    const raw = await readStdin();
    input = JSON.parse(raw) as HookInput;
  } catch {
    console.error("Failed to parse stdin JSON. Expected: { session_id, transcript_path, cwd, hook_event_name }");
    process.exit(1);
  }

  if (!input.session_id || !input.transcript_path) {
    console.error("Missing required fields: session_id and transcript_path");
    process.exit(1);
  }

  const { baseDir } = resolveStorageRoot({ cwd: input.cwd });
  const manager = new CaptureManager(baseDir);
  const entry = manager.capture(input);

  if (!entry) {
    console.error("No exchanges found in transcript");
    process.exit(0);
  }

  console.log(`Captured ${entry.message_count} exchanges → ${entry.raw_path}`);
}

main().catch((err) => {
  console.error("precompact-capture failed:", err);
  process.exit(1);
});
