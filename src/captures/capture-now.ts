#!/usr/bin/env node

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { CaptureManager } from "./CaptureManager.js";
import { discoverLatestTranscript } from "./discover-transcript.js";
import type { HookInput } from "./types.js";

function findRekindleBase(): string {
  const cwd = process.cwd();
  if (existsSync(resolve(cwd, ".rekindle"))) return cwd;

  const home = homedir();
  if (existsSync(resolve(home, ".rekindle"))) return home;

  return cwd;
}

function findLatestTranscript(): { sessionId: string; transcriptPath: string } | null {
  const transcriptArg = process.argv.find((a) => a.startsWith("--transcript="));
  if (transcriptArg) {
    const path = transcriptArg.split("=")[1];
    const parts = path.split("/");
    const filename = parts[parts.length - 1];
    const sessionId = filename.replace(".jsonl", "");
    return { sessionId, transcriptPath: path };
  }

  return discoverLatestTranscript();
}

async function main(): Promise<void> {
  const session = findLatestTranscript();
  if (!session) {
    console.error("Could not find an active session transcript.");
    console.error("Use --transcript=/path/to/session.jsonl to specify manually.");
    process.exit(1);
  }

  const input: HookInput = {
    session_id: session.sessionId,
    transcript_path: session.transcriptPath,
    cwd: process.cwd(),
    hook_event_name: "ManualCapture",
  };

  const baseDir = findRekindleBase();
  const manager = new CaptureManager(baseDir);
  const entry = manager.capture(input, "manual");

  if (!entry) {
    console.error("No exchanges found in transcript");
    process.exit(0);
  }

  console.log(`Captured ${entry.message_count} exchanges → ${entry.raw_path}`);
}

main().catch((err) => {
  console.error("capture-now failed:", err);
  process.exit(1);
});
