# Architecture

## Overview

Rekindle is an MCP (Model Context Protocol) server that provides persistent memory, structured orientation, and mid-session compaction survival for AI assistants. It runs as a local process communicating via stdio transport.

```
Claude Code / AI Client
    |
    | (stdio, JSON-RPC)
    |
Rekindle MCP Server (10 tools)
    |
    +-- Orientation pipeline (boot_report, end_session)
    |
    +-- Memory tools (store, search, list, delete, update)
    |
    +-- Capture tools (list_captures, read_capture, capture_now)
    |
    +-- Storage adapter (SQLite + FTS5)
    |
    +-- CaptureManager (transcript parsing, file-based captures)
    |
    +-- Identity document (user-maintained .md file)
```

## Storage Layer

### SQLite + FTS5

All data lives in a single SQLite database at `.rekindle/db/memories.db`. We use WAL mode for concurrent read performance.

The `memories` table stores structured memory records with typed metadata:

```sql
CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    importance INTEGER DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
    project TEXT,
    type TEXT,
    source TEXT,
    session_id TEXT,
    created_at TEXT,
    updated_at TEXT,
    retrieval_count INTEGER DEFAULT 0,
    last_accessed TEXT
);
```

The `memories_fts` virtual table provides full-text search using FTS5:

```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
    content, category, project,
    content='memories', content_rowid='rowid'
);
```

Three triggers keep the FTS index in sync with the content table on insert, update, and delete.

### Search Ranking

Search uses FTS5's BM25 algorithm for relevance scoring, then boosts results by importance:

```
final_score = bm25_score * (importance / 10.0)
```

A memory with importance 10 gets the full BM25 score. A memory with importance 1 gets 10% of it. This means high-importance memories surface first when relevance is similar.

Retrieval count and last-accessed timestamp are updated on every search hit, providing data for future consolidation features.

### Continuity Record Types

The `end_session` tool stores structured records with a `type` field:

| Type | Purpose |
|------|---------|
| `checkpoint` | Where we left off (required) |
| `decision` | What was decided and why |
| `open_loop` | Unresolved tasks or questions |
| `constraint` | Boundaries that must not be violated |
| `preference` | New user preferences learned |
| `warning` | Things next session should watch for |
| `relational_delta` | What changed in the working relationship |
| `next_session_focus` | Where to resume next session |

All records carry `source` and `session_id` metadata. The next `boot_report` loads the checkpoint automatically and surfaces open loops.

## Orientation Pipeline

The `boot_report` tool implements the orientation pipeline. When called at session start, it:

1. **Reads the identity document** from the configured path. This is a user-maintained Markdown file describing who they are, what matters to them, and how they prefer to work.

2. **Scans memory stats**: total count, breakdown by category and project, count of memories stored in the last 7 days.

3. **Finds the latest checkpoint**: the most recent continuity record, which serves as a session-end summary.

4. **Reads the latest transcript**: finds the most recent `.md` file in the transcripts directory and includes a preview.

5. **Surfaces open loops**: queries for `type='open_loop'` records from prior sessions, showing unresolved tasks that need follow-up.

6. **Surfaces PreCompact captures**: checks for any captures from prior compaction events that may contain recoverable context.

7. **Detects gaps**: compares what was loaded against what a healthy memory state looks like. Reports:
   - Missing identity document
   - Empty memory categories (no preferences stored, no lessons, etc.)
   - Stale data (nothing stored in 7+ days)
   - Missing transcripts
   - Missing project scope

8. **Calculates orientation score**: a transparent 100-point checklist across 6 criteria (identity, checkpoint, transcript, memory health, project scope, category coverage).

The AI then reports what it's carrying forward and what might be missing, before any work begins.

## PreCompact Capture System (v0.3)

Mid-session context compaction destroys reasoning chains, failed approaches, relational texture, and tone. The PreCompact capture system preserves what would otherwise be lost.

### How it works

```
Compaction event fires
    |
    v
PreCompact hook (npx rekindle precompact-capture)
    |
    +-- Reads hook input from stdin (session_id, transcript_path, cwd)
    +-- Parses JSONL transcript (last N messages, configurable)
    +-- Writes raw Markdown capture to .rekindle/captures/<session_id>/
    +-- Writes structured JSON snapshot (decisions, open loops, files touched)
    +-- Updates manifest.json for cheap listing
    |
    v
Post-compaction: model calls list_captures / read_capture to recover context
```

### Two-layer capture

**Raw layer** (mechanical, always reliable): Last N messages from the transcript, formatted as Markdown. This is the full conversational record.

**Structured layer** (best-effort extraction): JSON snapshot with decisions made, open loops, files modified, and a summary. Useful for quick orientation without reading the full raw capture.

### Three read modes

| Mode | Token cost | Use case |
|------|-----------|----------|
| `summary` | Low | Quick orientation check |
| `structured` | Moderate | Recover specific decisions or open loops |
| `raw` | High | Full transcript excerpt when detail matters |

### Review tracking

When `read_capture` is called, the capture is marked as reviewed in the manifest. `end_session` checks for unreviewed captures and warns the model if context may have been lost without recovery.

### Capture accumulation

Multiple compaction events in a long session produce sequential captures (compact-01, compact-02, etc.). Each capture is independent — later captures do not supersede earlier ones, because they cover different time windows.

## Session Capture

### Hooks

The PreCompact hook is a TypeScript CLI that reads Claude Code's hook input from stdin:

```json
{
  "session_id": "abc-123",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/path/to/project",
  "hook_event_name": "PreCompact"
}
```

Configure via `npx rekindle setup-hooks` or `npx rekindle init --with-hooks`. The hook config is written to `.claude/settings.local.json` (user-specific, not committed).

### Manual capture

`capture_now` (MCP tool or `npx rekindle capture-now` CLI) triggers a capture on demand without waiting for compaction. It auto-discovers the active session transcript.

## Init Scaffold

`npx rekindle init` creates the `.rekindle/` directory structure:

```
.rekindle/
  db/memories.db       SQLite database (initialized with schema)
  identity.md          Identity template (user fills in)
  transcripts/         Session transcript output directory
  captures/            PreCompact capture output directory
```

It also prints boot instructions for CLAUDE.md and MCP server configuration for the Claude Code config file. The optional `--with-hooks` flag configures the PreCompact hook during init.

## Design Decisions

**SQLite over Postgres/Supabase**: Zero setup, zero accounts, zero API keys. FTS5 is fast enough for 10,000+ memories. The entire system is local — no network calls, no telemetry.

**FTS5 over embeddings**: Full-text search with BM25 is effective for keyword and phrase matching without needing an embedding API. Semantic search via embeddings is planned for v0.4.

**Identity document as a file, not a memory**: The identity document is a Markdown file the user maintains directly. It's the anchor that persists even if the database is reset. Memories are AI-written; identity is human-written.

**Transcripts over summaries**: Session capture stores raw conversation, not a compressed summary. Summaries lose relational texture: tone, context shifts, emotional arcs. The boot report reads the raw transcript so the AI can form its own understanding.

**Two-layer capture over raw-only**: Raw captures are mechanically reliable. Structured snapshots are best-effort but save tokens at read time. Both are written; the model chooses the appropriate read mode.

**Hook setup is opt-in**: `npx rekindle init` does not silently install hooks. Users must explicitly run `setup-hooks` or pass `--with-hooks`. Modifying `.claude/settings.local.json` is a deliberate action.

**stdio transport**: Standard MCP transport that works with Claude Code out of the box. No HTTP server to configure, no ports to open.
