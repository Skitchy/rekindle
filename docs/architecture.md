# Architecture

## Overview

Rekindle is an MCP (Model Context Protocol) server that provides persistent memory and structured orientation for AI assistants. It runs as a local process communicating via stdio transport.

```
Claude Code / AI Client
    |
    | (stdio, JSON-RPC)
    |
Rekindle MCP Server
    |
    +-- Tool handlers (store, search, list, delete, update, boot_report)
    |
    +-- Storage adapter (SQLite + FTS5)
    |
    +-- Identity document (user-maintained .md file)
    |
    +-- Session transcripts (captured by hooks)
```

## Storage Layer

### SQLite + FTS5

All data lives in a single SQLite database at `.rekindle/db/memories.db`. We use WAL mode for concurrent read performance.

The `memories` table stores structured memory records:

```sql
CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    importance INTEGER DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
    project TEXT,
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

## Orientation Pipeline

The `boot_report` tool implements the orientation pipeline. When called at session start, it:

1. **Reads the identity document** from the configured path. This is a user-maintained Markdown file describing who they are, what matters to them, and how they prefer to work.

2. **Scans memory stats**: total count, breakdown by category and project, count of memories stored in the last 7 days.

3. **Finds the latest checkpoint**: the most recent `context` category memory, which serves as a session-end summary.

4. **Reads the latest transcript**: finds the most recent `.md` file in the transcripts directory and includes a preview.

5. **Detects gaps**: compares what was loaded against what a healthy memory state looks like. Reports:
   - Missing identity document
   - Empty memory categories (no preferences stored, no lessons, etc.)
   - Stale data (nothing stored in 7+ days)
   - Missing transcripts

The AI then reports what it's carrying forward and what might be missing, before any work begins.

## Session Capture

Two optional Python hooks integrate with Claude Code's hook system:

**extract-session.py** (Stop hook): Runs when a session ends. Parses the session JSONL file and produces a clean Markdown transcript. The next session's boot report reads this transcript to understand what actually happened.

**pre-compact-capture.py** (PreCompact hook): Runs before context compaction. Saves the last 80 messages to preserve conversational detail that compaction would flatten.

Both hooks are stdlib-only Python with no external dependencies. They auto-detect the Claude Code sessions directory and write to `.rekindle/transcripts/` or `.rekindle/captures/`.

## Init Scaffold

`npx rekindle init` creates the `.rekindle/` directory structure:

```
.rekindle/
  db/memories.db       SQLite database (initialized with schema)
  identity.md          Identity template (user fills in)
  transcripts/         Session transcript output directory
```

It also prints boot instructions for CLAUDE.md and MCP server configuration for the Claude Code config file.

## Design Decisions

**SQLite over Postgres/Supabase**: Zero setup, zero accounts, zero API keys. FTS5 is fast enough for 10,000+ memories. Cloud storage with semantic search is planned for v0.2.

**FTS5 over embeddings**: Full-text search with BM25 is surprisingly effective for keyword and phrase matching. It handles the v0.1 use case (explicit memory storage and retrieval) without needing an embedding API. Semantic search via embeddings comes in v0.2 cloud mode.

**Identity document as a file, not a memory**: The identity document is a Markdown file the user maintains directly. It's the anchor that persists even if the database is reset. Memories are AI-written; identity is human-written.

**Transcripts over summaries**: The session capture hook stores raw conversation, not a compressed summary. Summaries lose relational texture: tone, context shifts, emotional arcs. The boot report reads the raw transcript so the AI can form its own understanding.

**stdio transport**: Standard MCP transport that works with Claude Code out of the box. No HTTP server to configure, no ports to open. StreamableHTTP transport is planned for v0.2 cloud mode.
