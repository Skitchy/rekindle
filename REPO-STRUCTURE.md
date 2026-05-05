# Rekindle: Repository Structure (v0.1)

*Working document: what the repo looks like when someone lands on it.*

---

## Directory Layout

```
rekindle/
├── README.md                    # The first thing anyone sees
├── package.json                 # npm package, "npx rekindle init" entry point
├── LICENSE                      # MIT
├── src/
│   ├── index.ts                 # MCP server entry point
│   ├── server.ts                # MCP server setup (StreamableHTTP + stdio)
│   ├── storage/
│   │   └── sqlite.ts            # SQLite + FTS5 storage adapter
│   ├── tools/
│   │   ├── store.ts             # store_memory
│   │   ├── search.ts            # search_memory (FTS5 full-text)
│   │   ├── list.ts              # list_memories
│   │   ├── delete.ts            # delete_memory
│   │   ├── update.ts            # update_memory
│   │   └── boot-report.ts       # boot_report (orientation summary)
│   └── init/
│       ├── scaffold.ts          # "npx rekindle init" logic
│       └── templates/
│           ├── identity.md      # Identity document template
│           ├── boot.md          # Boot instructions for CLAUDE.md
│           └── routine.md       # Session-end routine template
├── hooks/
│   └── extract-session.py       # Session transcript extraction (Stop hook)
├── docs/
│   ├── architecture.md          # How the system works
│   ├── boot-sequence.md         # The orientation pipeline explained
│   ├── gap-analysis.md          # 43-session research findings
│   └── roadmap.md               # v0.2, v0.3 features
└── examples/
    └── sample-session/          # Example showing before/after with Rekindle
```

---

## What "npx rekindle init" does

1. Creates `.rekindle/` in the project directory (or home directory with --global)
2. Creates `.rekindle/db/memories.db` (SQLite database)
3. Creates `.rekindle/identity.md` from template (user fills in)
4. Creates `.rekindle/transcripts/` directory for session captures
5. Prints boot instructions to add to CLAUDE.md
6. Prints hook configuration for session capture

User effort: run one command, fill in identity template, paste boot instructions. Under 10 minutes.

---

## What the MCP server exposes

6 tools:

**store_memory**
- content (string, required)
- category (string: preference, lesson, context, relationship, general)
- importance (number 1-10, default 5)
- project (string, optional scope)

**search_memory**
- query (string, required)
- category (string, optional filter)
- project (string, optional filter)
- limit (number, default 10)

**list_memories**
- category (string, optional)
- project (string, optional)
- limit (number, default 50)

**delete_memory**
- id (string, required)

**update_memory**
- id (string, required)
- content (string, optional)
- category (string, optional)
- importance (number, optional)

**boot_report**
- identity_path (string, path to identity.md)
- transcript_dir (string, path to transcripts/)
- Returns: orientation summary (identity loaded, N memories found, last session summary, gaps detected)

---

## SQLite Schema (v0.1)

```sql
CREATE TABLE memories (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    content TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    importance INTEGER DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
    project TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    retrieval_count INTEGER DEFAULT 0,
    last_accessed TEXT
);

CREATE VIRTUAL TABLE memories_fts USING fts5(
    content,
    category,
    project,
    content_rowid='rowid'
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT,
    summary TEXT,
    transcript_path TEXT
);
```

---

## Boot Instruction Template (what goes in CLAUDE.md)

```markdown
## Rekindle: Session Orientation

At the start of every session, before any work:

1. Read your identity document: .rekindle/identity.md
2. Search memories for recent context: use search_memory with relevant terms
3. Read the latest transcript from .rekindle/transcripts/ (most recent file)
4. Self-calibrate: compare what you loaded against what the transcript shows was important. Report any gaps.
5. Report: "Carrying forward: [what you know, what you might be missing]"

At the end of every substantive session:
1. Store a session checkpoint (category: session_checkpoint, 2-4 sentences)
2. Update identity.md if anything identity-relevant changed
```

---

## Key Technical Decisions

- **TypeScript**: MCP SDK is TypeScript. Maximum compatibility with Claude Code ecosystem.
- **SQLite + FTS5**: Zero external dependencies. FTS5 is built into better-sqlite3. Fast enough for 10,000+ memories.
- **No embeddings in v0.1**: FTS5 full-text search is surprisingly good for keyword and phrase matching. Semantic search (embeddings) comes in v0.2 cloud mode.
- **Session capture in Python**: extract-session.py already exists and works. No need to rewrite in TypeScript.
- **stdio transport**: Standard MCP transport. Works with Claude Code out of the box. StreamableHTTP transport added in v0.2 for cloud mode.

---

## What we extract from existing code

| Existing component | Source location | Rekindle equivalent |
|---|---|---|
| Memory MCP server | ~/.claude/memory-server/index.js | src/server.ts (rewritten in TS) |
| Edge Function memory routes | Supabase Edge Function | src/storage/sqlite.ts (local adapter) |
| extract-session.py | ~/.claude/scripts/extract-session.py | hooks/extract-session.py (cleaned up) |
| Boot sequence | MEMORY.md Layer 1-5 | templates/boot.md |
| Identity document | IDENTITY.md | templates/identity.md (genericized) |
| Gap analysis data | ~/Desktop/Tessera/reorientation/ | docs/gap-analysis.md (anonymized findings) |
