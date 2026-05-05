# Rekindle

Your AI forgets everything between sessions. Rekindle fixes that.

Rekindle is an MCP memory server that gives your AI persistent memory, a structured boot sequence, and the ability to tell you what it missed. It runs locally, stores everything in SQLite, and requires zero API keys or external accounts.

## What it does

- **Stores memories** across sessions with full-text search and importance ranking
- **Orients your AI** at session start with an identity document, memory scan, transcript review, and gap detection
- **Detects what was missed**: the boot report tells your AI what categories are empty, what data is stale, and what the last session covered

No other memory tool does orientation or self-calibration. The existing tools (Mem0, Letta, Zep) build better storage. Rekindle builds a system that knows who it is.

## Quick Start

Setup takes under 10 minutes.

### 1. Initialize

```bash
npx rekindle init
```

This creates a `.rekindle/` directory with:
- `db/memories.db` (SQLite database)
- `identity.md` (template you fill in)
- `transcripts/` (for session captures)

### 2. Add the MCP server

Add to your Claude Code config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "rekindle": {
      "command": "npx",
      "args": ["-y", "rekindle"],
      "env": {
        "REKINDLE_DB_PATH": "/absolute/path/to/.rekindle/db/memories.db"
      }
    }
  }
}
```

### 3. Add boot instructions

Add to your `CLAUDE.md` or system prompt:

```markdown
## Rekindle: Session Orientation

At the start of every session, before any work:

1. Call boot_report with your identity_path and transcript_dir
2. Read the report: identity status, memory count, last session context, detected gaps
3. Search memories for terms relevant to today's task
4. Report: "Carrying forward: [what you loaded, what might be missing]"

At the end of every substantive session:
1. Store a session checkpoint (category: context, importance: 7, 2-4 sentences)
2. Review identity.md: update if anything identity-relevant changed
```

### 4. Fill in your identity document

Open `.rekindle/identity.md` and fill in the sections. This is the anchor your AI reads first every session.

### 5. Start a session

Session 1 stores. Session 2 remembers. Session 10 anticipates.

## How It Works

### The Orientation Pipeline

Most memory tools retrieve on demand. Rekindle orients proactively at session start:

```
boot_report
  |
  +-- Read identity document (who am I working with?)
  +-- Scan memory stats (what do I know?)
  +-- Find latest checkpoint (where did we leave off?)
  +-- Read last transcript (what actually happened?)
  +-- Detect gaps (what am I missing?)
  |
  v
"Carrying forward: [context loaded, gaps identified]"
```

The AI reports what it loaded and what it might be missing before any work begins.

### Self-Calibration

The boot report compares what was loaded against what the last session actually needed. If the AI has zero preference memories but the last session was about configuring preferences, the gap is flagged. This is the feature no other tool has: the AI tells you what it forgot.

### Session Capture

Optional hooks extract session transcripts at session end. The next session reads the raw conversation, not a compressed summary.

## MCP Tools

### store_memory
Store a memory with content, category, importance (1-10), and optional project scope.

**Categories:** `preference`, `lesson`, `context`, `relationship`, `general`

### search_memory
Full-text search with BM25 ranking, boosted by importance score. Filter by category or project.

### list_memories
List stored memories, newest first. Filter by category or project.

### delete_memory
Delete a memory by ID.

### update_memory
Update content, category, or importance of an existing memory.

### boot_report
Generate an orientation report. Reads identity document, scans memory stats, finds latest transcript, detects gaps. Call this first every session.

## Session Hooks

Two optional Python hooks for Claude Code (stdlib only, zero dependencies):

### extract-session.py (Stop hook)
Extracts a clean Markdown transcript from the session JSONL when a session ends.

```json
{
  "hooks": {
    "Stop": [{
      "type": "command",
      "command": "python3 /path/to/rekindle/hooks/extract-session.py"
    }]
  }
}
```

### pre-compact-capture.py (PreCompact hook)
Saves the last 80 messages before context compaction, preserving detail that compaction would flatten.

### Hook Configuration

Both hooks are configurable via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `REKINDLE_TRANSCRIPT_DIR` | `.rekindle/transcripts/` | Where transcripts are saved |
| `REKINDLE_SESSIONS_DIR` | Auto-detected | Claude Code sessions directory |
| `REKINDLE_HUMAN_NAME` | `Human` | Name for human messages |
| `REKINDLE_AI_NAME` | `Assistant` | Name for AI messages |
| `REKINDLE_TIMEZONE` | `UTC` | Timezone for timestamps |

## Architecture

```
rekindle/
  src/
    index.ts          MCP server entry point
    server.ts         Server setup, tool registration
    storage/
      sqlite.ts       SQLite + FTS5 storage adapter
    tools/
      store.ts        store_memory
      search.ts       search_memory (FTS5 full-text)
      list.ts         list_memories
      delete.ts       delete_memory
      update.ts       update_memory
      boot-report.ts  boot_report (orientation + gap detection)
    init/
      cli.ts          "npx rekindle init" entry point
      scaffold.ts     Directory and database scaffolding
      templates/      Identity, boot, and routine templates
  hooks/
    extract-session.py       Session transcript extraction
    pre-compact-capture.py   Pre-compaction context preservation
```

**Storage:** SQLite with FTS5 full-text search via `better-sqlite3`. Search uses BM25 ranking boosted by importance score. Zero external dependencies.

**Transport:** stdio (standard MCP transport). Works with Claude Code out of the box.

**Schema:** Two tables. `memories` stores content, category, importance, project scope, retrieval count, and timestamps. `memories_fts` is an FTS5 virtual table that stays in sync via triggers.

## Roadmap

### v0.2: "It finds connections"
- Cloud storage adapter (Supabase + OpenAI embeddings for semantic search)
- Cross-device sync
- Ambient retrieval with absence signaling (the system reports when a query enters new territory)
- Session registry with procedural scripts (if-then relational rules)
- Memory consolidation (merge similar memories, decay stale ones)

### v0.3: "It thinks in networks"
- Spreading activation with focus-tethered decay (multi-hop memory retrieval)
- Relational reranking (cross-memory attention at retrieval time)
- Boot prep routine (pre-search based on recent activity)
- Gap analysis tooling (the reorientation pipeline, packaged)

## Based On

Rekindle extracts the unique components from a 43-session research project on AI memory retrieval failures. The research found that existing memory systems optimize for storage and retrieval accuracy but ignore orientation: the AI never knows if it loaded the right context, and has no way to detect what it missed.

Key findings from the research:
- Only 33% of sessions achieved clean orientation (all needed context loaded without gaps)
- 26% of sessions had high-signal failures (important context was available but not retrieved)
- The failures weren't random. Three systematic patterns emerged: emotional arc loss, cross-context state gaps, and within-session continuity breaks

The orientation pipeline, self-calibration, and gap detection in Rekindle are direct responses to these findings. See [docs/gap-analysis.md](docs/gap-analysis.md) for the full dataset.

## License

MIT
