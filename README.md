# Rekindle

Your AI forgets everything between sessions. Rekindle fixes that.

Rekindle is an MCP memory server that solves **session orientation**, not just storage. It gives your AI persistent memory, a structured boot sequence, and gap detection that flags what was missed. All local, all SQLite, zero API keys.

**Status:** v0.1.0 pre-release, working and tested. Early testers wanted.

## Quick Start

```bash
npx rekindle init
```

This creates `.rekindle/` in your current directory with a SQLite database, identity template, and transcript directory. It prints two blocks to copy:

1. **MCP config** — paste into `~/.claude.json` (tells Claude Code where the server is)
2. **Boot instructions** — paste into your project's `CLAUDE.md` (tells the AI how to orient)

Then fill in `.rekindle/identity.md` and start a new Claude Code session.

Session 1 stores. Session 2 remembers. Session 10 anticipates.

![Rekindle init demo](docs/demo.gif)

## The Problem (43 Sessions of Data)

Over 43 sessions, we measured what an AI assistant failed to load at session start. The results:

| Metric | Value |
|--------|-------|
| Sessions analyzed | 43 |
| Clean boots (all context loaded) | 33% |
| High-signal failures (5+ gaps) | 26% |
| Total retrieval failures | 173 |

Existing memory tools (Mem0, Letta, Zep) optimize for retrieval accuracy: can the AI find what it stored? That's necessary but not sufficient. None of them address whether the AI loaded the *right* context for *this* session, or whether it can detect what it missed.

Rekindle is not trying to be the biggest memory store. It solves session orientation: loading identity, recent context, memory health, and missing-context warnings before the assistant starts work.

See [docs/gap-analysis.md](docs/gap-analysis.md) for the full research dataset.

## Example: What a Boot Report Looks Like

After a few sessions of use, `boot_report` produces this:

```
## Identity
Loaded from .rekindle/identity.md

[Your identity document content]

## Memories
14 total (14 in last 7 days)

By category:
  context: 4
  lesson: 6
  preference: 2
  relationship: 2

By project:
  dev-setup: 2
  rekindle: 9

## Last Checkpoint
Building an MCP memory server with orientation pipeline.
Phase 4 complete. Next: session hooks and docs.

## Last Session Transcript
session-2026-05-05-120000.md

[Preview of last conversation]

## Gaps Detected
None. Orientation looks complete.
```

When context is sparse, the gaps section flags what's missing:

```
## Gaps Detected
- No identity document found. Run 'npx rekindle init' or create .rekindle/identity.md
- No context memories stored
- No relationship memories stored
- No session transcripts found. Configure the session capture hook for richer orientation.
```

The AI sees this before any work begins and reports: "Carrying forward: [what I loaded, what might be missing]."

See [examples/sample-session/](examples/sample-session/) for a complete example: filled-in identity document, sample memories, a session transcript, and both healthy and sparse boot reports.

## Why not just use CLAUDE.md or a memory file?

A static file is passive. Your AI reads it, but it can't search it, rank it, track what's been retrieved, or tell you what's missing. Rekindle adds:

- Full-text search with importance-weighted ranking
- Category and project scoping across memories
- Retrieval tracking (what gets used, what doesn't)
- An orientation pipeline that loads identity, context, and transcripts at boot
- Gap detection that reports empty categories, stale data, and missing context

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

### Gap Detection

The boot report performs structural gap detection: it flags missing identity documents, empty memory categories, stale data (nothing stored in 7+ days), absent checkpoints, and missing transcripts. This is not semantic understanding of what was missed. It is a systematic check that the AI's context is healthy before work begins.

### Session Capture

Optional hooks extract session transcripts at session end. The next session reads the raw conversation, not a compressed summary. Raw transcripts preserve tone, context shifts, and conversational detail that summaries lose.

## MCP Tools

| Tool | Description |
|------|-------------|
| `store_memory` | Store a memory with content, category, importance (1-10), and optional project scope |
| `search_memory` | Full-text search with BM25 ranking, boosted by importance. Filter by category or project |
| `list_memories` | List stored memories, newest first. Filter by category or project |
| `delete_memory` | Delete a memory by ID |
| `update_memory` | Update content, category, or importance of an existing memory |
| `boot_report` | Orientation report: identity, memory stats, last checkpoint, last transcript, gap detection |

**Categories:** `preference`, `lesson`, `context`, `relationship`, `general`

## What's Built, What's Tested, What's Next

**Implemented and tested** (v0.1.0 — this release):
- SQLite storage with FTS5 full-text search and BM25 ranking
- 6 MCP tools: store, search, list, delete, update, boot_report
- Importance-weighted search (importance score boosts BM25 rank)
- Boot report with identity loading, memory stats, checkpoint retrieval, transcript reading
- Structural gap detection (missing identity, empty categories, stale data, absent transcripts)
- Category and project scoping across all operations
- Init scaffold with identity template and directory setup
- Session capture hooks (stdlib Python, zero dependencies)
- 37 automated tests (unit + integration + performance benchmark)

**Experimental — working but not yet validated at scale:**
- Orientation quality improvement (the 43-session data shows the problem exists; Rekindle addresses it structurally, but we haven't yet measured improvement over a comparable session count)
- Gap detection effectiveness (structural checks catch missing categories and stale data; they don't catch *semantically* missing context — that requires the v0.2 work below)
- Retrieval tracking (the infrastructure exists; we haven't built analysis tooling around it yet)

**On the roadmap** (not in this release):
- Orientation as a first-class domain layer with structured JSON output (v0.2)
- Orientation scoring — transparent weighted checklist (v0.2)
- End-session tool for closing the continuity loop (v0.2)
- Typed continuity records: checkpoint, decision, open_loop, preference, repair (v0.2)
- Path security — restrict boot_report file access (v0.2)
- Semantic search via embeddings (v0.2)
- Spreading activation / multi-hop retrieval (v0.3)
- Gap analysis tooling for measuring orientation quality over time (v0.3)

See [docs/roadmap.md](docs/roadmap.md) for details on each planned feature.

## Install from Source

If you want to inspect or modify the code:

```bash
git clone https://github.com/Skitchy/rekindle.git
cd rekindle
npm install
npm run build
node dist/init/cli.js init
```

The init command prints the same MCP config and boot instructions as the npm path.

## Privacy and Security

- **All data is local.** Memories, transcripts, and identity documents are stored in `.rekindle/` in your project or home directory. Nothing is sent to external servers.
- **No network calls.** The MCP server communicates via stdio. No HTTP, no telemetry, no analytics.
- **Transcripts contain conversation text.** The session capture hook copies user and assistant messages from Claude Code's session JSONL. Do not enable transcript capture if your sessions contain secrets, credentials, or sensitive information you don't want stored on disk.
- **Transcript capture is optional.** The hooks are not installed by default. You configure them explicitly.
- **SQLite database is a regular file.** It has the same file permissions as any other file in your project. It is not encrypted. If you need encryption, use OS-level disk encryption.
- **Add `.rekindle/` to `.gitignore`.** The init command does this automatically (creates `.gitignore` if none exists, or appends to an existing one). Your memories and transcripts should not be committed to version control.
- **boot_report reads local files.** In v0.1, `boot_report` reads from whatever `identity_path` and `transcript_dir` are passed in the tool call. Paths are not sandboxed. Only use Rekindle with MCP clients and prompts you trust. Path restriction is planned for v0.2.

## Session Hooks

Two optional Python hooks for Claude Code (stdlib only, zero external dependencies):

**extract-session.py** (Stop hook): Extracts a Markdown transcript from the session JSONL when a session ends.

**pre-compact-capture.py** (PreCompact hook): Saves the last 80 messages before context compaction.

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

Both hooks are configurable via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `REKINDLE_TRANSCRIPT_DIR` | `.rekindle/transcripts/` | Where transcripts are saved |
| `REKINDLE_SESSIONS_DIR` | Auto-detected | Claude Code sessions directory |
| `REKINDLE_HUMAN_NAME` | `Human` | Name for human messages |
| `REKINDLE_AI_NAME` | `Assistant` | Name for AI messages |
| `REKINDLE_TIMEZONE` | `UTC` | Timezone for timestamps |

## Compatibility

| Environment | Status |
|-------------|--------|
| Claude Code (macOS) | Supported, tested |
| Claude Code (Linux) | Should work, untested |
| Claude Code (Windows) | Untested (better-sqlite3 may need build tools) |
| Claude Desktop | Untested (uses same MCP protocol) |
| Cursor, Continue, Cline | Untested (should work if they support MCP stdio) |
| Other MCP clients | Untested |

## Tests

```bash
npm test
```

37 tests covering:
- SQLite storage: CRUD operations, FTS5 search ranking, importance boosting, category/project filtering
- MCP integration: all 6 tools via in-memory transport, boot report with identity/transcripts/gaps
- Performance: 1000-memory search under 100ms

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
      cli.ts          CLI entry point
      scaffold.ts     Directory and database scaffolding
      templates/      Identity, boot, and routine templates
  hooks/
    extract-session.py       Session transcript extraction
    pre-compact-capture.py   Pre-compaction context preservation
```

**Storage:** SQLite with FTS5 full-text search via `better-sqlite3`. Search uses BM25 ranking boosted by importance score. No external services required.

**Transport:** stdio (standard MCP transport). Works with Claude Code out of the box.

## Roadmap

### v0.2: "It knows where it stands"
Orientation becomes the architecture, not just a feature. The core refactor: extract orientation into a first-class domain layer with structured output, orientation scoring, session tracking, richer memory metadata (`source`, `session_id`, `expires_at`), config file, path security, and cloud storage with semantic search.

### v0.3: "It thinks in networks"
Memory as a network, not a list. Spreading activation, relational reranking, boot prep routine, gap analysis tooling, eval harness, and maintenance tools.

## License

MIT
