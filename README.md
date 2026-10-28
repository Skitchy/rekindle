<div align="center">

# Rekindle

[![npm](https://img.shields.io/npm/v/rekindle)](https://www.npmjs.com/package/rekindle)
[![CI](https://github.com/Skitchy/rekindle/actions/workflows/ci.yml/badge.svg)](https://github.com/Skitchy/rekindle/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Glama score](https://glama.ai/mcp/servers/Skitchy/rekindle/badges/score.svg)](https://glama.ai/mcp/servers/Skitchy/rekindle)

**For Claude Code users who lose time re-explaining project context every session.**

```bash
npx rekindle init
```

*Your AI forgets everything between sessions. Rekindle fixes that.*

</div>

---

![Rekindle init demo](https://raw.githubusercontent.com/Skitchy/rekindle/main/docs/demo.gif)

Rekindle is an MCP continuity engine that solves **session orientation**, not just storage. Orient at session start, capture at session end, survive mid-session compaction. All local, all SQLite, zero API keys.

**v0.5.0**: a **user card**, one Markdown file about you that any agent can read, so a new agent starts out knowing how you work. Plus fixes for transcript discovery, capture tagging and identity scoring. [Release notes](https://github.com/Skitchy/rekindle/releases/tag/v0.5.0)

## Quick Start

Requires Node.js 22 or newer.

```bash
npx rekindle init
```

This creates `.rekindle/` in your project with a SQLite database, identity template, continuity policy, project registry, captures directory, and transcript directory. Then add the MCP server config for your client:

<details open>
<summary><strong>Claude Code</strong></summary>

One command registers the server:
```bash
claude mcp add rekindle -- npx -y rekindle
```

Or add it to `~/.claude.json` by hand:
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

Without `--global`, both commands write the project-local `.claude/settings.local.json`, so the hooks run only for sessions started in that directory. With `--global`, they write the user-scope `~/.claude/settings.json`, which Claude Code applies in every project on the machine; register the server at the same scope so it is present wherever the hooks fire: `claude mcp add --scope user rekindle -- npx -y rekindle` (plain `claude mcp add` is local to the current project).

Session-start delivery resolves the hook's real working directory through
`.rekindle/projects.json`. Exact roots match by default; nested directories
inherit only when an entry sets `"include_descendants": true`. An unmapped or
ambiguous workspace is reported as `UNKNOWN PROJECT` and never receives a
checkpoint or context record from another project. `REKINDLE_PROJECT` remains
an explicit override, and receipts record which resolution rule won.

`.rekindle/policy.json` controls transcript handling, the startup byte budget,
and mandatory versus optional packet sections. Mandatory sections are atomic:
if they do not fit, Rekindle emits a bounded failure manifest instead of a
partial anchor. Optional sections are omitted whole and recorded in the
receipt. Set `"transcript_mode": "excluded"` to prevent SessionStart from
reading transcript files or paths and to mark transcript coverage N/A in the
orientation score. Set `"background_writes_allowed": false` to make the
automatic PreCompact hook exit without creating a capture; manual capture
remains a separate, explicit action.
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

See [docs/gap-analysis.md](https://github.com/Skitchy/rekindle/blob/main/docs/gap-analysis.md) for the full research dataset.

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

### Carry you between agents: the user card (v0.5)

`identity.md` tells the agent who *it* is. The user card tells any agent who *you* are: how to talk to you, your boundaries, your projects, what to avoid. It's one plain Markdown file that you own and edit; agents suggest changes, you decide.

```bash
npx rekindle card template ~/user-card.md     # start one (never overwrites)
npx rekindle card compile --out ~/card-draft  # or draft one from what your agent already knows
npx rekindle card path ~/user-card.md         # load it at session start for this store
```

- **Opt-in.** With no card configured, the startup packet is unchanged.
- **Whole or nothing.** The card is the first optional section after the required ones. If it doesn't fit the startup budget it's left out, never cut off partway.
- **Diagnostics stay out of the packet.** Whether the card was included, dropped, missing or unreadable is recorded in the delivery receipt (`user_card`), never in the packet.
- **`compile` drafts, you decide.** It gathers project-less preferences and constraints, your identity file's "What I Know About My Person" section, any projects you name (each line dated) and any reviewed files you pass with `--from`. It writes `card-draft.md` and a review worksheet, and it never writes over your card. Its detection of conflicts, secrets and stale entries is incomplete, so the draft is a candidate list for you to review, not a cleaned card.
- **One card, many agents.** Point every store you use at the same file. Agents that can't read your machine (cloud agents) need their own copy; see [docs/user-card.md](https://github.com/Skitchy/rekindle/blob/main/docs/user-card.md).
- **Trust limit.** Any agent with ordinary file access can edit the card file. Rekindle doesn't prevent that; keep the card somewhere you review.

`REKINDLE_USER_CARD` overrides the configured path; a blank value counts as unset.

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

## Release Highlights

**v0.5.0**

- **User card** ([#32](https://github.com/Skitchy/rekindle/pull/32)): one Markdown file about the user that any agent can read. `rekindle card template`, `card path`, `card compile`, and `init --card`. Opt-in; with no card configured, startup output is unchanged. See [above](#carry-you-between-agents-the-user-card-v05)
- **Transcript discovery stays in the current workspace** ([#29](https://github.com/Skitchy/rekindle/issues/29)): automatic discovery could return another project's transcript. It now matches Claude Code's folder naming and only accepts a transcript that records this workspace as its working directory
- **`capture_now` keeps a transcript with its own session** ([#28](https://github.com/Skitchy/rekindle/issues/28)): a supplied `transcript_path` names its own session; a supplied `session_id` never borrows another session's transcript; blank ids are refused
- **Captures are tagged with the resolved project** ([#30](https://github.com/Skitchy/rekindle/issues/30)): captures use the same project resolution as session start. **Behavior change:** a capture made where no project resolves is now untagged (`project: null`, with a warning) instead of being labelled with the folder name
- **An unfilled identity template no longer scores** ([#31](https://github.com/Skitchy/rekindle/issues/31)): the shipped template earns no identity points and shows an `identity_unfilled` warning; the text is still delivered. **Behavior change:** the score line now reads "Identity document filled in", and fresh installs score 20 points lower until `identity.md` is filled in

**v0.4.1**

- **`--global` hooks fire everywhere** — `setup-hooks --global`, `setup-delivery --global` and `init --global --with-*` now write `~/.claude/settings.json` (user scope) instead of `~/.claude/settings.local.json`, which Claude Code reads only for sessions started in the home directory ([#25](https://github.com/Skitchy/rekindle/issues/25)). Project-local setup is unchanged. Each command prints the file it wrote
- **Unresolved-workspace warning names the fix** — when the session-start packet cannot map the workspace to a project it now says that no checkpoint was loaded and points at the two remedies: add the workspace to the registry it read (`.rekindle/projects.json` for a project store, `~/.rekindle/projects.json` for a `--global` store), or set `REKINDLE_PROJECT`. The warning does not expose the absolute registry path
- **Init output matches this README** — `init` leads with `claude mcp add rekindle -- npx -y rekindle` (`claude mcp add --scope user ...` under `--global`, so the server is registered wherever the global hooks fire), lists both opt-in hooks (with `--global` when used), and prints `~/.rekindle/...` paths under `--global`

**v0.4.0**

- **Node.js 22 or newer required** — Node 20 reached end of life in April 2026 and is no longer supported; CI runs on Node 22, 24 and 26
- **Policy-aware session start** — `.rekindle/policy.json` controls transcript handling (`transcript_mode`: `captured`, `tail-read-only`, or `excluded`), the startup byte budget, mandatory versus optional packet sections, and whether background hooks may write (`background_writes_allowed`)
- **Project-safe delivery** — `.rekindle/projects.json` maps workspaces to projects; an unmapped or ambiguous workspace is reported as `UNKNOWN PROJECT` and never receives another project's checkpoint; `REKINDLE_PROJECT` is an explicit override
- **Transcript filename withheld in tail mode** — in `tail-read-only` mode the packet shows the transcript tail but not the file's name
- **Atomic session writes** — a session row and its audit row commit together or not at all
- **Clean production audit** — `npm audit --omit=dev` found zero vulnerabilities (production dependencies)
- **Smaller package** — the npm tarball drops from about 1.9 MB to about 110 KB; evidence and design documents stay on GitHub

**v0.3.3**

- **Version-consistent protocol metadata** — the MCP initialize response derives its version from the shipped package metadata, preventing release-version drift
- **Package-page accuracy** — the README shipped to npm identifies the current release before the tag and package are created
- **Expanded automated tests**, plus a packed-artifact check that compares MCP metadata to the installed package version

**v0.3.2**

- **One-command delivery install** — `npx rekindle setup-delivery` (or `init --with-delivery`) configures the SessionStart hook opt-in: idempotent, preserves other tools' hooks, refuses corrupted settings files
- **147 automated tests**

**v0.3.1 — "Five Measured Gates"**

- **Session-start delivery** — `rekindle session-start` emits a budgeted orientation packet via the SessionStart hook at startup, resume, `/clear`, and `/compact`
- **Budgeted packets, truthful receipts** — packets cap at 8,000 valid UTF-8 bytes with an in-packet truncation marker; receipts attest emission only and never claim model visibility
- **Desktop-safe storage** — storage root never derives from the spawn point (Claude Desktop spawns MCP servers at `/`); explicit resolution order, fail-loud
- **Dual-channel guidance** — workflow guidance rides both tool descriptions and MCP instructions, drift structurally impossible
- **Cursor adapter** — `session-start --client cursor` with whitelist stdin parsing; email and workspace paths never reach receipts
- **Measured, not assumed** — every claim above is backed by a published measurement ([evidence](https://github.com/Skitchy/rekindle/tree/main/docs/evidence-v0.3.1-measurements), [spike results](https://github.com/Skitchy/rekindle/blob/main/docs/compatibility-spike-results.md))

**v0.3.0 — "Survive the Long Middle"** added the PreCompact capture system, open loops, and review tracking — [v0.3.0 release notes](https://github.com/Skitchy/rekindle/releases/tag/v0.3.0)

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `npx rekindle init` | Set up `.rekindle/` in current directory |
| `npx rekindle init --global` | Set up in home directory; hooks go to `~/.claude/settings.json` |
| `npx rekindle init --with-hooks` | Init + configure PreCompact capture hook |
| `npx rekindle init --with-delivery` | Init + configure SessionStart delivery hook |
| `npx rekindle init --card <file>` | Init + load `<file>` as the user card at session start |
| `npx rekindle setup-hooks` | Configure PreCompact capture hook (standalone) |
| `npx rekindle setup-delivery` | Configure SessionStart delivery hook (standalone) |
| `npx rekindle session-start` | Emit budgeted orientation packet (SessionStart hook) |
| `npx rekindle session-start --client cursor` | Same, in Cursor's hook response shape |
| `npx rekindle precompact-capture` | Capture context before compaction (hook) |
| `npx rekindle capture-now` | Manually capture current session context |
| `npx rekindle card template <file>` | Write a starter user card (never overwrites) |
| `npx rekindle card path <file>` | Load `<file>` as the user card at session start (`--clear` to stop; no argument shows the current one) |
| `npx rekindle card compile --out <dir>` | Draft a user card from what the store knows, plus a review worksheet (`--include-project <name>`, `--from <file.md>`) |
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

The `setup-hooks` command writes this to `.claude/settings.local.json` (or `~/.claude/settings.json` with `--global`):

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

"Full delivery" means the orientation packet arrives automatically at session boundaries and the model demonstrably sees it — measured with canary probes at both the receipt layer and the model layer, not assumed. Details and evidence: [compatibility spike results](https://github.com/Skitchy/rekindle/blob/main/docs/compatibility-spike-results.md).

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

writes this to `.claude/settings.local.json` (or `~/.claude/settings.json` with `--global`):

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
      budget.ts       UTF-8 packet construction and atomic mandatory sections
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

The suite runs in CI on Node 22, 24 and 26 and covers: storage CRUD + FTS5 ranking, orientation domain (gap detection, policy-aware scoring, project resolution, service, rendering), capture manager (parsing, limits, review tracking, formatting), delivery (atomic packet budget, receipts, guidance channels, Cursor privacy sentinels), the user card (path resolution, whole-or-nothing delivery, compile safeguards), hook setup for both hooks (schema, idempotency, corruption refusal), and MCP integration (all 10 tools plus package-derived server metadata).

## Roadmap

**Next: "It thinks in networks"** — Spreading activation, semantic search via embeddings, gap analysis tooling, eval harness.

## License

MIT
