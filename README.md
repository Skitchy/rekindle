<div align="center">

# Rekindle

[![npm](https://img.shields.io/npm/v/rekindle)](https://www.npmjs.com/package/rekindle)
[![tests](https://img.shields.io/badge/tests-147%20passing-brightgreen)](#tests)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Glama score](https://glama.ai/mcp/servers/Skitchy/rekindle/badges/score.svg)](https://glama.ai/mcp/servers/Skitchy/rekindle)

**For Claude Code users who lose time re-explaining project context every session.**

```bash
npx rekindle init
```

*Your AI forgets everything between sessions. Rekindle fixes that.*

</div>

---

![Rekindle init demo](docs/demo.gif)

Rekindle is an MCP continuity engine that solves **session orientation**, not just storage. Orient at session start, capture at session end, survive mid-session compaction. All local, all SQLite, zero API keys.

**v0.3.1 — "Five Measured Gates"** — session-start orientation delivery for Claude Code, budgeted packets with truthful receipts, Desktop-safe storage, Cursor adapter with structural privacy. Every claim measured. [Release notes](https://github.com/Skitchy/rekindle/releases/tag/v0.3.1)

## Quick Start

Requires Node.js 20 or newer.

```bash
npx rekindle init
```

This creates `.rekindle/` in your project with a SQLite database, identity template, captures directory, and transcript directory. Then add the MCP server config for your client:

<details open>
<summary><strong>Claude Code</strong></summary>

Add to `~/.claude.json`:
```json
{
  "mcpServers": {
    "rekindle": {
      "command": "npx",
      "args": ["-y", "rekindle"]
    }
  }
}
```

Enable PreCompact protection (captures context before mid-session compaction):
```bash
npx rekindle setup-hooks
```

Enable session-start orientation delivery — the budgeted orientation packet arrives automatically at startup, resume, `/clear`, and `/compact`, so the model re-orients at every context boundary without being asked:
```bash
npx rekindle setup-delivery
```

Both hooks are opt-in; plain `init` never installs either. `npx rekindle init --with-hooks --with-delivery` does everything in one line.
</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

Add to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):
```json
{
  "mcpServers": {
    "rekindle": {
      "command": "npx",
      "args": ["-y", "rekindle"]
    }
  }
}
```
</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to `.cursor/mcp.json` in your project root:
```json
{
  "mcpServers": {
    "rekindle": {
      "command": "npx",
      "args": ["-y", "rekindle"]
    }
  }
}
```
</details>

Then fill in `.rekindle/identity.md` and paste the boot instructions into your project's `CLAUDE.md`.

> Session 1 stores. Session 2 remembers. Session 10 anticipates.

---

## The Problem (43 Sessions of Data)

Over 43 sessions, we measured what an AI assistant failed to load at session start:

| Metric | Value |
|--------|-------|
| Sessions analyzed | 43 |
| Clean boots (all context loaded) | 33% |
| High-signal failures (5+ gaps) | 26% |
| Total retrieval failures | 173 |

Existing memory tools (Mem0, Letta, Zep) optimize for retrieval accuracy: can the AI find what it stored? That's necessary but not sufficient. None of them address whether the AI loaded the *right* context for *this* session, or whether it can detect what it missed.

Rekindle solves session orientation: loading identity, recent context, memory health, and missing-context warnings before the assistant starts work.

See [docs/gap-analysis.md](docs/gap-analysis.md) for the full research dataset.

---

## What It Does

### Boot: orient at session start

`boot_report` runs an orientation pipeline before any work begins:

```
boot_report
  +-- Read identity document (who am I working with?)
  +-- Scan memory stats (what do I know?)
  +-- Find latest checkpoint (where did we leave off?)
  +-- Read last transcript (what actually happened?)
  +-- Surface open loops (what needs follow-up?)
  +-- Surface PreCompact captures (what survived compaction?)
  +-- Detect gaps (what am I missing?)
  +-- Calculate orientation score (how oriented am I?)
  --> "Carrying forward: [context loaded, gaps identified, score: 80/100]"
```

### Survive the Long Middle: PreCompact capture (v0.3)

Mid-session compaction destroys reasoning chains, failed approaches, relational texture, and tone. The PreCompact hook fires automatically before compaction and saves what would otherwise be lost:

```
PreCompact hook fires
  +-- Parse JSONL transcript (last N messages)
  +-- Write raw Markdown capture (.rekindle/captures/)
  +-- Write structured JSON snapshot (decisions, open loops, files)
  +-- Update manifest for cheap listing
  --> boot_report surfaces captures on next session start
  --> end_session warns if captures exist but weren't reviewed
```

Three read modes control token cost:
- **summary** — one paragraph, cheap
- **structured** — decisions/loops/warnings, moderate
- **raw** — full transcript excerpt, expensive (only when needed)

### Capture: close the loop at session end

`end_session` stores structured continuity records — not just a summary:

| Field | What it captures |
|-------|-----------------|
| `checkpoint` | Where we left off (required) |
| `decisions` | What was decided and why |
| `open_loops` | Unresolved tasks or questions |
| `constraints` | Boundaries that must not be violated |
| `relational_delta` | What changed in the working relationship |
| `next_session_focus` | Where to resume next session |
| `preferences` | New user preferences learned |
| `warnings` | Things next session should watch for |

All records stored with `type`, `source`, and `session_id` metadata. Next `boot_report` loads the checkpoint automatically.

### Between sessions: search and manage

| Tool | Description |
|------|-------------|
| `store_memory` | Store with content, category, importance (1-10), and project scope |
| `search_memory` | Full-text search with BM25 ranking, boosted by importance |
| `list_memories` | Browse memories, newest first. Filter by category or project |
| `delete_memory` | Delete by ID |
| `update_memory` | Update content, category, or importance |
| `list_captures` | List PreCompact captures (optionally filter by session) |
| `read_capture` | Read a capture in summary, structured, or raw mode |
| `capture_now` | Manually capture current session context on demand |

**Categories:** `preference` `lesson` `context` `relationship` `general`

---

## Why not just CLAUDE.md?

A static file is passive. Your AI reads it, but it can't search it, rank it, track what's been retrieved, or tell you what's missing. Rekindle adds:

- **Search** — full-text with importance-weighted ranking
- **Structure** — category and project scoping across memories
- **Orientation** — proactive context loading at boot, not just on-demand retrieval
- **Gap detection** — flags missing identity, empty categories, stale data
- **Scoring** — transparent checklist so you know *how oriented* the AI is
- **Session capture** — structured close with checkpoints, decisions, and open loops
- **Compaction survival** — PreCompact captures preserve what summaries flatten

---

## v0.3.1 Highlights

- **Session-start delivery** — `rekindle session-start` emits a budgeted orientation packet via the SessionStart hook at startup, resume, `/clear`, and `/compact`; `setup-delivery` installs it opt-in
- **Budgeted packets, truthful receipts** — packets cap at 8,000 valid UTF-8 bytes with an in-packet truncation marker; receipts attest emission only and never claim model visibility
- **Desktop-safe storage** — storage root never derives from the spawn point (Claude Desktop spawns MCP servers at `/`); explicit resolution order, fail-loud
- **Dual-channel guidance** — workflow guidance rides both tool descriptions and MCP instructions, drift structurally impossible
- **Cursor adapter** — `session-start --client cursor` with whitelist stdin parsing; email and workspace paths never reach receipts
- **Measured, not assumed** — every claim above is backed by a published measurement ([evidence](docs/evidence-v0.3.1-measurements), [spike results](docs/compatibility-spike-results.md))
- **147 automated tests**

v0.3.0 ("Survive the Long Middle") added the PreCompact capture system, open loops, and review tracking — [v0.3.0 release notes](https://github.com/Skitchy/rekindle/releases/tag/v0.3.0)

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `npx rekindle init` | Set up `.rekindle/` in current directory |
| `npx rekindle init --global` | Set up in home directory |
| `npx rekindle init --with-hooks` | Init + configure PreCompact capture hook |
| `npx rekindle init --with-delivery` | Init + configure SessionStart delivery hook |
| `npx rekindle setup-hooks` | Configure PreCompact capture hook (standalone) |
| `npx rekindle setup-delivery` | Configure SessionStart delivery hook (standalone) |
| `npx rekindle session-start` | Emit budgeted orientation packet (SessionStart hook) |
| `npx rekindle session-start --client cursor` | Same, in Cursor's hook response shape |
| `npx rekindle precompact-capture` | Capture context before compaction (hook) |
| `npx rekindle capture-now` | Manually capture current session context |
| `npx rekindle` | Start MCP server (used by Claude Code) |

---

## Install from Source

```bash
git clone https://github.com/Skitchy/rekindle.git
cd rekindle
npm install
npm run build
node dist/init/cli.js init
```

<details>
<summary><strong>PreCompact Hook Configuration</strong></summary>

The `setup-hooks` command writes this to `.claude/settings.local.json`:

```json
{
  "hooks": {
    "PreCompact": [
      {
        "matcher": "auto",
        "hooks": [
          {
            "type": "command",
            "command": "npx rekindle precompact-capture",
            "timeout": 60
          }
        ]
      },
      {
        "matcher": "manual",
        "hooks": [
          {
            "type": "command",
            "command": "npx rekindle precompact-capture",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

The hook receives session context on stdin (session_id, transcript_path, cwd, hook_event_name) and writes captures to `.rekindle/captures/`.

| Variable | Default | Description |
|----------|---------|-------------|
| `REKINDLE_PRECOMPACT_MAX_MESSAGES` | `80` | Max messages to capture |
| `REKINDLE_PRECOMPACT_MAX_CHARS` | `120000` | Max characters to capture |
| `REKINDLE_BASE_DIR` | Resolved (see below) | Base directory for `.rekindle/` |

**Storage root resolution.** All Rekindle entry points (server, PreCompact hook) resolve the directory holding `.rekindle/` through one rule, in order:

1. `REKINDLE_BASE_DIR`, if set — explicit always wins
2. Derived from `REKINDLE_DB_PATH`, when it points at a canonical `<base>/.rekindle/db/` layout
3. An existing `.rekindle/` in the current working directory (never when cwd is the filesystem root)
4. An existing `.rekindle/` in your home directory
5. Otherwise: your home directory — never the spawn point

Rules 3 and 5 exist because some hosts (e.g. Claude Desktop) spawn MCP servers at `cwd=/`; a spawn point is not a storage location. If storage cannot be created, the server exits with a message naming the fix instead of a stack trace.

</details>

<details>
<summary><strong>Privacy and Security</strong></summary>

- **All data is local.** Nothing is sent to external servers.
- **No network calls.** The MCP server communicates via stdio. No HTTP, no telemetry, no analytics.
- **Transcripts contain conversation text.** Do not enable transcript capture if your sessions contain secrets or credentials.
- **Hook installation is opt-in.** Both the capture hook (`setup-hooks`) and the delivery hook (`setup-delivery`) must be requested explicitly, by command or by flag. Plain `init` never installs either.
- **SQLite database is a regular file.** Not encrypted. Use OS-level disk encryption if needed.
- **`.rekindle/` is gitignored.** The init command handles this automatically.
- **boot_report reads local files.** Paths are not sandboxed. Only use with MCP clients and prompts you trust.

</details>

## Compatibility

"Full delivery" means the orientation packet arrives automatically at session boundaries and the model demonstrably sees it — measured with canary probes at both the receipt layer and the model layer, not assumed. Details and evidence: [compatibility spike results](docs/compatibility-spike-results.md).

| Client surface | MCP tools | Session-start delivery |
|--------|-----------|--------|
| Claude Code terminal (macOS) | Tested | Full delivery, measured (startup, resume, `/clear`, `/compact`) |
| Claude Code terminal (Windows) | Tested | Full delivery, measured |
| Claude Code terminal (Linux/WSL2) | Tested | Hook channel identical; delivery measurement pending |
| Claude Desktop, Code surface | Tested | Full delivery, measured (`/clear` re-delivers via new-session startup) |
| Claude Desktop, chat surface | Tested | Tool-mode only: hooks unsupported by the client; guidance reachable via the model's tool-search |
| Cursor | Tested | Via `.cursor/hooks.json`, measured (see below) |
| Any MCP stdio client | Compatible | Depends on the client's hook support |

### Claude Code: session-start orientation (opt-in)

```bash
npx rekindle setup-delivery
```

writes this to `.claude/settings.local.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          { "type": "command", "command": "npx rekindle session-start", "timeout": 60 }
        ]
      }
    ]
  }
}
```

The packet is capped at 8,000 valid UTF-8 bytes — measured: when hook output exceeds the host's limit, the model sees only the leading portion, with no error surfaced. If sections are dropped to fit the budget, an in-packet marker says so, and the receipt in `.rekindle/receipts/session-start.jsonl` records exactly what was emitted without ever claiming the model saw it.

### Cursor: session-start orientation (opt-in)

Cursor's hook system can deliver the budgeted orientation packet at session
start, measured working in the v0.3.1 compatibility spike. Setup is manual
and opt-in — Rekindle never installs hooks without being asked. Add to
`.cursor/hooks.json` in your project:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [ { "command": "rekindle session-start --client cursor" } ]
  }
}
```

**Privacy:** Cursor's hook payload includes your account email and workspace
paths. The adapter treats that payload as personal by default: it extracts
only the session ID and workspace root (used in-process for storage
resolution), and neither the raw payload, the email, nor any path is ever
written to receipts or any other artifact. Background agents are bypassed by
default (truthfully receipted); opt in with `REKINDLE_ORIENT_BACKGROUND_AGENTS=1`.

<details>
<summary><strong>Architecture</strong></summary>

```
rekindle/
  src/
    index.ts          MCP server entry point
    server.ts         Server setup, tool registration (10 tools)
    storage/
      sqlite.ts       SQLite + FTS5, schema migration, sessions
    orientation/
      types.ts        OrientationResult, Gap, ScoreItem
      GapDetector.ts  Structural gap detection (8 codes)
      Scorer.ts       Orientation scoring (6 criteria, 100pts)
      OrientationService.ts   Orchestrator
      OrientationRenderer.ts  Markdown + JSON output
    captures/
      types.ts        CaptureEntry, StructuredSnapshot, HookInput
      CaptureManager.ts   Parse, capture, list, read, review tracking
      discover-transcript.ts  Auto-discover session transcripts
      precompact-capture.ts   CLI hook entry point
      capture-now.ts          Manual capture CLI
    tools/
      boot-report.ts  Orientation + open loops + capture awareness
      end-session.ts  Structured session close + capture warning
      list-captures.ts  List PreCompact captures
      read-capture.ts   Read captures in 3 modes
      capture-now.ts    Model-triggered manual capture
      store.ts search.ts list.ts delete.ts update.ts
    delivery/
      budget.ts       8000-byte UTF-8 packet construction, truncation marker
      receipts.ts     Emission receipts (never claim model visibility)
      session-start.ts SessionStart hook adapter
      cursor.ts       Cursor hook adapter (privacy-whitelisted stdin)
      guidance.ts     Canonical workflow guidance, both channels
    init/
      cli.ts scaffold.ts setup-hooks.ts setup-delivery.ts templates/
```

**Storage:** SQLite + FTS5 via `better-sqlite3`. BM25 ranking boosted by importance. Typed records with `type`, `source`, `session_id`.

**Transport:** stdio (standard MCP). Works with Claude Code out of the box.

</details>

## Tests

```bash
npm test
```

147 tests: storage CRUD + FTS5 ranking, orientation domain (gap detection, scoring, service, rendering), capture manager (parsing, limits, review tracking, formatting), delivery (packet budget, receipts, guidance channels, Cursor privacy sentinels), hook setup for both hooks (schema, idempotency, corruption refusal), and MCP integration (all 10 tools).

## Roadmap

**v0.4: "It thinks in networks"** — Spreading activation, semantic search via embeddings, gap analysis tooling, eval harness.

## License

MIT
