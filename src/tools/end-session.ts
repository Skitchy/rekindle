import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RekindleStorage } from "../storage/sqlite.js";

interface StoredRecord {
  type: string;
  id: string;
  content: string;
}

export function registerEndSession(
  server: McpServer,
  storage: RekindleStorage
): void {
  server.tool(
    "end_session",
    "Capture a structured session handoff. Writes multiple records to the local SQLite database: one checkpoint (required), plus optional decisions, open loops, preferences, constraints, warnings, relational delta, and next session focus. Each record is stored with a typed 'type' column (not content prefixes) and linked to a session record via session_id. Also creates a session row in the sessions table with a summary, orientation score, and gap count. The checkpoint is retrievable by boot_report on the next session start. All records are searchable via search_memory and list_memories. Call this at the end of every substantive session to ensure the next session can pick up the thread.",
    {
      checkpoint: z
        .string()
        .describe("Where we left off — the single most important handoff artifact. Stored as type='checkpoint' with importance 8. This is what boot_report loads as the latest checkpoint on the next session start."),
      decisions: z
        .array(z.string())
        .optional()
        .describe("Key decisions made this session and their rationale. Each entry is stored as a separate memory with type='decision' and importance 7."),
      open_loops: z
        .array(z.string())
        .optional()
        .describe("Unresolved questions, pending tasks, or threads that need follow-up. Each entry is stored as type='open_loop' with importance 7."),
      preferences: z
        .array(z.string())
        .optional()
        .describe("New user preferences or working style observations learned this session. Each entry is stored as type='preference' with importance 6."),
      constraints: z
        .array(z.string())
        .optional()
        .describe("Boundaries that must not be violated — violating these causes trust damage. Each entry is stored as type='constraint' with importance 9 (highest default)."),
      warnings: z
        .array(z.string())
        .optional()
        .describe("Hazards or risks the next session should be aware of. Each entry is stored as type='warning' with importance 8."),
      relational_delta: z
        .string()
        .optional()
        .describe(
          "What changed in the working relationship this session — trust shifts, tension, repair, tone changes. Stored as type='relational_delta' with importance 8."
        ),
      next_session_focus: z
        .string()
        .optional()
        .describe("Where to resume next session, which may differ from where we stopped. Stored as type='next_session_focus' with importance 7."),
      project: z.string().optional().describe("Project name to scope all records to. Passed through to each stored memory's project field."),
      transcript_path: z
        .string()
        .optional()
        .describe("File path to the session transcript, stored on the session record for reference by boot_report."),
    },
    async ({
      checkpoint,
      decisions,
      open_loops,
      preferences,
      constraints,
      warnings,
      relational_delta,
      next_session_focus,
      project,
      transcript_path,
    }) => {
      const sessionId = storage.createSession({
        summary: "",
        transcriptPath: transcript_path,
        project,
      });

      const stored: StoredRecord[] = [];
      const endSessionOpts = (type: string) => ({
        type,
        source: "end_session" as const,
        session_id: sessionId,
      });

      const cpId = storage.store(
        checkpoint,
        "context",
        8,
        project,
        endSessionOpts("checkpoint")
      );
      stored.push({ type: "checkpoint", id: cpId, content: checkpoint });

      for (const d of decisions ?? []) {
        const id = storage.store(d, "context", 7, project, endSessionOpts("decision"));
        stored.push({ type: "decision", id, content: d });
      }

      for (const ol of open_loops ?? []) {
        const id = storage.store(ol, "context", 7, project, endSessionOpts("open_loop"));
        stored.push({ type: "open_loop", id, content: ol });
      }

      for (const p of preferences ?? []) {
        const id = storage.store(p, "preference", 6, project, endSessionOpts("preference"));
        stored.push({ type: "preference", id, content: p });
      }

      for (const c of constraints ?? []) {
        const id = storage.store(c, "lesson", 9, project, endSessionOpts("constraint"));
        stored.push({ type: "constraint", id, content: c });
      }

      for (const w of warnings ?? []) {
        const id = storage.store(w, "lesson", 8, project, endSessionOpts("warning"));
        stored.push({ type: "warning", id, content: w });
      }

      if (relational_delta) {
        const id = storage.store(
          relational_delta,
          "relationship",
          8,
          project,
          endSessionOpts("relational_delta")
        );
        stored.push({ type: "relational_delta", id, content: relational_delta });
      }

      if (next_session_focus) {
        const id = storage.store(
          next_session_focus,
          "context",
          7,
          project,
          endSessionOpts("next_session_focus")
        );
        stored.push({ type: "next_session_focus", id, content: next_session_focus });
      }

      const counts: Record<string, number> = {};
      for (const r of stored) {
        counts[r.type] = (counts[r.type] ?? 0) + 1;
      }

      const summaryParts = [`Checkpoint: ${checkpoint}`];
      if (decisions?.length) summaryParts.push(`Decisions: ${decisions.length}`);
      if (open_loops?.length) summaryParts.push(`Open loops: ${open_loops.length}`);
      if (preferences?.length) summaryParts.push(`Preferences: ${preferences.length}`);
      if (constraints?.length) summaryParts.push(`Constraints: ${constraints.length}`);
      if (warnings?.length) summaryParts.push(`Warnings: ${warnings.length}`);
      if (relational_delta) summaryParts.push(`Relational delta captured`);
      if (next_session_focus) summaryParts.push(`Next focus set`);

      const summary = summaryParts.join(". ");

      const session = storage.getSession(sessionId);
      if (session) {
        storage.updateSession(sessionId, {
          summary,
          checkpointMemoryId: cpId,
        });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              session_id: sessionId,
              stored_count: stored.length,
              stored: counts,
              summary,
              message:
                "Session captured. Next boot will load the checkpoint; open loops and other continuity records are stored and searchable.",
            }, null, 2),
          },
        ],
      };
    }
  );
}
