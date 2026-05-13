#!/usr/bin/env node

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RekindleStorage } from "../dist/storage/sqlite.js";
import { OrientationService } from "../dist/orientation/OrientationService.js";
import { OrientationRenderer } from "../dist/orientation/OrientationRenderer.js";

const tmpDir = mkdtempSync(join(tmpdir(), "rekindle-v02-test-"));
const dbPath = join(tmpDir, "db", "memories.db");
const storage = new RekindleStorage(dbPath);

console.log("=== Rekindle v0.2.0 Live Test ===\n");
console.log(`DB: ${dbPath}\n`);

// --- Seed some memories ---
console.log("--- Seeding memories ---");
storage.store("User prefers direct feedback, no fluff", "preference", 7, "rekindle");
storage.store("SQLite + FTS5 chosen for local-first architecture", "lesson", 8, "rekindle");
storage.store("Skitch is a water treatment operator in California", "relationship", 6, "rekindle");
storage.store("Boot sequence should load identity before tasks", "context", 9, "rekindle");
console.log("Stored 4 memories\n");

// --- Create identity file ---
const identityPath = join(tmpDir, "identity.md");
writeFileSync(identityPath, `# Identity

I am Rekindle, a local continuity engine for AI assistants.
I help sessions start oriented and end deliberately.
`);
console.log(`Identity written to ${identityPath}\n`);

// --- Create a transcript ---
const transcriptDir = join(tmpDir, "transcripts");
mkdirSync(transcriptDir);
writeFileSync(join(transcriptDir, "session-2026-05-06-203000.md"), `# Session 2026-05-06

**Skitch:** Let's build the orientation layer.

**CC:** Starting with the schema migration — adding type, source, and session_id columns.

**Skitch:** I like Ari's feedback about adding constraints and relational_delta.

**CC:** Agreed. The end_session tool now captures 10 fields for a complete continuity closeout.
`);
console.log("Transcript written\n");

// --- Run boot_report via OrientationService ---
console.log("=== BOOT REPORT ===\n");
const service = new OrientationService(storage);
const result = service.generate({
  identityPath,
  transcriptDir,
  project: "rekindle",
});

const markdown = OrientationRenderer.toMarkdown(result);
console.log(markdown);

console.log("\n\n=== STRUCTURED RESULT (JSON) ===\n");
const json = JSON.parse(OrientationRenderer.toJSON(result));
console.log(`Score: ${json.score}/100`);
console.log(`Gaps: ${json.gaps.length}`);
json.gaps.forEach(g => console.log(`  [${g.severity}] ${g.code}: ${g.message}`));
console.log(`Breakdown:`);
json.scoreBreakdown.forEach(s => console.log(`  ${s.earned ? "✓" : "✗"} ${s.label} (${s.points}pts)`));

// --- Simulate end_session ---
console.log("\n\n=== END SESSION SIMULATION ===\n");

const sessionId = storage.createSession({
  summary: "",
  project: "rekindle",
});

const cpId = storage.store(
  "Completed v0.2 orientation layer and end_session tool. 64 tests passing.",
  "context", 8, "rekindle",
  { type: "checkpoint", source: "end_session", session_id: sessionId }
);

storage.store(
  "Use type column instead of content prefixes for continuity records",
  "context", 7, "rekindle",
  { type: "decision", source: "end_session", session_id: sessionId }
);

storage.store(
  "npm publish v0.2.0 and update blog post",
  "context", 7, "rekindle",
  { type: "open_loop", source: "end_session", session_id: sessionId }
);

storage.store(
  "Do not frame Tessera as consciousness proof",
  "lesson", 9, "rekindle",
  { type: "constraint", source: "end_session", session_id: sessionId }
);

storage.store(
  "Trust strengthened through collaborative architecture review with Ari",
  "relationship", 8, "rekindle",
  { type: "relational_delta", source: "end_session", session_id: sessionId }
);

storage.store(
  "Write v0.2 announcement, get Ari's review of final code",
  "context", 7, "rekindle",
  { type: "next_session_focus", source: "end_session", session_id: sessionId }
);

storage.updateSession(sessionId, {
  summary: "Checkpoint: Completed v0.2. Decisions: 1. Open loops: 1. Constraints: 1. Relational delta captured. Next focus set.",
  checkpointMemoryId: cpId,
});

console.log(`Session created: ${sessionId}`);
console.log(`Checkpoint stored: ${cpId}`);

const session = storage.getSession(sessionId);
console.log(`Session summary: ${session?.summary}`);

// --- Run boot_report again to show end_session data ---
console.log("\n\n=== BOOT REPORT AFTER END_SESSION ===\n");
const result2 = service.generate({
  identityPath,
  transcriptDir,
  project: "rekindle",
});
console.log(OrientationRenderer.toMarkdown(result2));

// --- Show type column working ---
console.log("\n\n=== MEMORY TYPE COLUMN ===\n");
const allMemories = storage.list({ project: "rekindle", limit: 20 });
for (const m of allMemories) {
  console.log(`[${m.type}] (${m.category}, importance:${m.importance}) ${m.content.slice(0, 60)}...`);
}

// --- Cleanup ---
storage.close();
rmSync(tmpDir, { recursive: true, force: true });
console.log("\n\nTest complete. Temp files cleaned up.");
