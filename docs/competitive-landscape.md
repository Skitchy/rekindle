# Rekindle Competitive Landscape

Initial pass prepared by Ari for Skitch and CC.

Last reviewed: 2026-05-08

## Purpose

This document maps nearby open-source projects so Rekindle can be positioned honestly and sharply.

Rekindle should not be framed as generic AI memory. The stronger lane is continuity:

> Help an assistant orient at session start, preserve what matters during compaction, capture where the session ended, and begin the next session with known context plus known gaps.

That distinction matters because the field around MCP memory, project context, and AI coding continuity is already active. Rekindle is not alone. Its job is not to pretend otherwise. Its job is to be clearer about the specific loop it solves.

## Rekindle's Current Position

Rekindle currently presents itself as an MCP continuity engine for AI coding assistants.

Current core claims/features:

- `npx rekindle init`
- Local SQLite storage
- MCP server over stdio
- Boot orientation via `boot_report`
- Structural gap detection
- Orientation scoring
- `end_session` structured closeout
- Typed continuity records with `type`, `source`, and `session_id`
- PreCompact capture system for mid-session compaction
- Capture review tracking
- Claude Code hook setup
- Claude Desktop / Cursor compatibility
- 101 automated tests

The most important public phrase remains:

> Session orientation, not just storage.

The v0.3 phrasing also adds a second strong hook:

> Survive the long middle.

That is good. It names a real pain point: not only cold starts, but context collapse during long work.

## Search Method

This pass used targeted GitHub searches around:

- MCP memory server
- Claude Code context memory
- session continuity AI assistant
- local-first AI memory
- persistent context MCP
- agent memory frameworks
- temporal context graph

This is not exhaustive. GitHub search is noisy and recency-biased. Some projects may be missing because they use different language, are private, are not indexed well, or live primarily on npm/PyPI rather than GitHub.

## Summary Table

| Tier | Project | Similarity | Main overlap | Main difference |
|---|---|---:|---|---|
| 1 | `mkreyman/mcp-memory-keeper` | Very high | Claude Code MCP context persistence, checkpoints, compaction helper, SQLite, npm | Broader memory/checkpoint board; less explicit orientation/gap ritual |
| 1 | `zackbrooks84/continuum` | Very high | Persistent memory, smart resume, checkpoints, token guard, local SQLite, cross-agent handoff | Adds background task queue/daemon; broader automation OS |
| 1 | `dunova/ContextGO` | High | Local-first cross-session AI coding history, Claude/Codex/shell indexing, hybrid search | Index/search engine more than explicit boot/end continuity ritual |
| 1 | `GreatScottyMac/context-portal` / ConPort | High | MCP project memory bank, decisions, active context, progress, relationships, SQLite | Strong project knowledge graph/RAG backend; less session-close/re-entry ritual |
| 2 | `contextfs/contextfs` | Medium-high | Persistent memory, semantic search, codebase indexing, MCP integration | More memory/indexing/cloud-sync oriented than continuity loop |
| 2 | `corbyjamesibm/persistent-context-mcp` | Medium | MCP persistent context, graph DB, web UI, semantic search | Heavier Neo4j/web-stack setup; less lightweight beginner path |
| 2 | `pinkpixel-dev/mem0-mcp` | Medium | MCP bridge for persistent memory across sessions | Mem0/Supabase/OpenAI-backed memory service; not local-first continuity ritual |
| 3 | `mem0ai/mem0` | Medium | Major AI memory layer, benchmark/retrieval focus | Infrastructure/framework; not Claude Code continuity tool |
| 3 | `getzep/graphiti` | Medium | Temporal context graph, provenance, evolving facts, agent memory | Architectural reference more than direct product competitor |
| 3 | `letta-ai/letta` | Medium | Stateful agents with memory and continual learning | Full agent framework, not a drop-in continuity layer for existing AI coding clients |

## Tier 1: Direct Competitors / Closest Neighbors

### 1. mcp-memory-keeper

Repository: https://github.com/mkreyman/mcp-memory-keeper

Why it matters:

This is the closest direct competitor found in the first pass. It targets Claude Code, MCP, persistent context, checkpoints, categories, priorities, channels, search, summarization, compaction help, and npm install.

Positioning overlap:

- "Never lose context during compaction again"
- Claude Code context management
- Persistent local context
- Checkpoints
- Full-text search
- Categories and priorities
- SQLite-based storage
- Fast `npx` / Claude MCP setup

Strengths:

- Very mature-looking README
- npm badges and CI/codecov badges
- 38 tools with tool profiles
- Channel model for project/topic organization
- Git integration
- Checkpoint restore
- Context relationships
- Export/import
- Token limit configuration
- Windows/macOS/Linux install claims

Risks to Rekindle:

This project may be perceived as already solving much of the same problem. It uses similar pain language, has more tools, and looks production-polished.

Rekindle differentiation:

- Rekindle should not compete on tool count.
- Rekindle should compete on the disciplined continuity loop:
  - boot orientation
  - explicit gap detection
  - orientation score
  - end-session continuity capture
  - typed continuity artifacts
  - PreCompact capture review
  - relational/process continuity fields
- Rekindle can be smaller, clearer, and less overwhelming.

Suggested positioning against it:

> Memory Keeper gives Claude a persistent board. Rekindle gives Claude a continuity ritual: orient, detect gaps, capture the ending, and resume with known context.

### 2. Continuum

Repository: https://github.com/zackbrooks84/continuum

Why it matters:

Continuum is conceptually very close. It explicitly targets the pain of re-explaining a project every session, and combines persistent memory with smart resume, checkpoints, token guard, task execution, and cross-agent handoff.

Positioning overlap:

- Re-explaining project context every session
- Persistent memory
- Smart resume
- Checkpoints
- Local SQLite
- Claude Code support
- Cross-agent handoffs
- Token/context budget guard
- Auto-observe / auto-checkpoint

Strengths:

- Strong product language
- Background daemon and task queue
- Compact session briefing
- Auto-checkpointing at context threshold
- Project file sync to `MEMORY.md`, `DECISIONS.md`, `TASKS.md`
- Remote bridge to Claude.ai Custom Connectors
- Cross-agent handoff exports

Risks to Rekindle:

Continuum has a wider surface area and may sound more powerful to users who want automation, background tasks, and personal AI OS behavior.

Rekindle differentiation:

- Rekindle is simpler and narrower.
- Rekindle is MCP-first and continuity-protocol-first.
- Rekindle's PreCompact feature is focused specifically on compaction survival and capture review.
- Rekindle should avoid trying to become a task queue unless user demand proves it.

Suggested positioning against it:

> Continuum is an AI workbench with memory and automation. Rekindle is a focused continuity engine for session handoff and compaction survival.

### 3. ContextGO

Repository: https://github.com/dunova/ContextGO

Why it matters:

ContextGO is a serious local-first context and memory engine for multi-agent coding teams. It indexes Claude Code, Codex, Cursor, shell history, and other tools. It emphasizes hybrid search, native scanning, cross-tool history, and strong test/coverage claims.

Positioning overlap:

- Local-first
- AI coding session history
- Claude Code support
- Cross-session memory
- Search across past work
- SQLite storage
- Hybrid semantic/BM25 retrieval

Strengths:

- Strong technical credibility
- Cross-tool source discovery
- Hybrid search with benchmark numbers
- Large test count and coverage claims
- Multi-agent / multi-tool history story
- Codebase/session indexing beyond MCP

Risks to Rekindle:

ContextGO may win users who primarily want historical search across all AI tool usage. It has strong technical proof and a broader ingestion model.

Rekindle differentiation:

- Rekindle is not trying to index every historical source.
- Rekindle should emphasize active continuity rituals inside the assistant workflow.
- Rekindle captures structured session endings and compaction moments, not just searchable history.

Suggested positioning against it:

> ContextGO helps search the past. Rekindle helps the next session start correctly and close cleanly.

### 4. Context Portal MCP / ConPort

Repository: https://github.com/GreatScottyMac/context-portal

Why it matters:

ConPort is a database-backed MCP project memory bank. It stores product context, active context, decisions, progress, patterns, custom data, relationships, history, semantic search, import/export, and strategy files for AI coding tools.

Positioning overlap:

- MCP server
- Project memory bank
- SQLite per workspace
- Decisions and progress tracking
- Active context
- Semantic search
- Custom AI instructions for using memory
- Replaces file-based memory banks

Strengths:

- Mature project-context model
- Explicit categories for product context, active context, decisions, progress, patterns
- Knowledge graph / linking features
- Strategy docs for Roo, Cline, Windsurf, generic MCP agents
- Workspace detection
- Import/export

Risks to Rekindle:

ConPort has a sophisticated project-memory schema and may appeal strongly to users who want structured project knowledge.

Rekindle differentiation:

- Rekindle is not only a project memory bank.
- Rekindle's value is time-bound continuity: what happened at boot, what was missing, what got captured before compaction, and what must be carried into next session.
- Rekindle's relationship/process continuity fields are more directly aligned with human-AI collaboration texture.

Suggested positioning against it:

> ConPort structures project knowledge. Rekindle structures session continuity.

## Tier 2: Adjacent Tools

### 5. ContextFS

Repository: https://github.com/contextfs/contextfs

Why it matters:

ContextFS gives AI agents persistent memory, semantic search, codebase indexing, MCP integration, and optional cloud sync.

Overlap:

- Persistent memory
- Cross-session memory
- MCP integration
- Codebase indexing
- Multi-tool support

Difference:

- More of a memory/indexing infrastructure layer.
- Less focused on explicit session handoff, boot reports, gap detection, and end-session capture.

Rekindle lesson:

ContextFS is a reminder that semantic search and codebase indexing are expected capabilities in the broader market. Rekindle does not need them first, but v0.4 semantic search should stay on the roadmap.

### 6. persistent-context-mcp

Repository: https://github.com/corbyjamesibm/persistent-context-mcp

Why it matters:

This is another MCP persistent context system, but with Neo4j, web UI, Docker/Podman, CLI, semantic search, graph visualization, templates, and analytics.

Overlap:

- MCP context persistence
- Semantic/keyword search
- Graph relationships
- Web UI
- CLI management

Difference:

- Heavier setup.
- Neo4j dependency.
- More enterprise/context-dashboard shaped.

Rekindle lesson:

Rekindle's lightweight `npx rekindle init` and local SQLite design are real advantages. Do not lose that simplicity.

### 7. mem0-mcp

Repository: https://github.com/pinkpixel-dev/mem0-mcp

Why it matters:

It is an MCP server that exposes Mem0 memory functions to AI assistants.

Overlap:

- MCP memory server
- Store/search/delete memories
- Cloud, Supabase, or local modes
- Cross-session memory

Difference:

- Depends on Mem0/Supabase/OpenAI for most meaningful persistence/search modes.
- Memory retrieval tool, not a continuity protocol.

Rekindle lesson:

Rekindle's no-API-key local posture remains a differentiator. Keep privacy and no telemetry visible.

## Tier 3: Major Frameworks / Architectural References

### 8. Mem0

Repository: https://github.com/mem0ai/mem0

Why it matters:

Mem0 is a major AI memory layer with serious benchmark, SDK, cloud, CLI, and production positioning.

Overlap:

- Long-term AI memory
- User/session/agent memory
- Hybrid retrieval
- Personalization
- Benchmarks

Difference:

- It is memory infrastructure, not a Claude Code continuity tool.
- It focuses on scalable retrieval quality and personalization.
- It is not primarily about boot orientation or end-session handoff.

Rekindle lesson:

Do not claim Rekindle beats Mem0 at memory. That is the wrong battlefield.

Better contrast:

> Mem0 optimizes memory retrieval. Rekindle optimizes session re-entry.

### 9. Graphiti / Zep

Repository: https://github.com/getzep/graphiti

Why it matters:

Graphiti is an important architectural reference: temporal context graphs, evolving facts, provenance, validity windows, hybrid retrieval, graph traversal, and MCP support.

Overlap:

- Agent memory
- Temporal context
- Provenance
- Evolving facts
- MCP server
- Hybrid retrieval

Difference:

- Graphiti is a context graph engine.
- Rekindle is a session continuity engine.
- Graphiti requires graph DB/LLM/embedding infrastructure.

Rekindle lesson:

The future Rekindle schema should keep provenance and temporal validity in mind. Typed records plus session IDs are a good start. Future fields worth considering:

- `valid_from`
- `valid_until`
- `supersedes_id`
- `source_episode_id`
- `confidence`

### 10. Letta

Repository: https://github.com/letta-ai/letta

Why it matters:

Letta is a major stateful agent framework with advanced memory, local terminal agents, hosted API, skills, subagents, and continual learning.

Overlap:

- Stateful agents
- Advanced memory
- Continual learning
- Local coding agents

Difference:

- It is a full agent framework.
- Rekindle is a drop-in continuity layer for existing MCP-capable clients.

Rekindle lesson:

Rekindle should not try to become the agent. Rekindle should help the agent remember how to resume.

## Feature Matrix

| Capability | Rekindle | Memory Keeper | Continuum | ContextGO | ConPort | Mem0 | Graphiti |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| MCP server | Yes | Yes | Yes | Partial/agent-facing | Yes | Via MCP bridge / related | Yes |
| One-command install | Yes | Yes | Partial | Yes | Yes via `uvx` | Yes | Yes, but infra required |
| Local-first | Yes | Yes | Yes | Yes | Yes | Not primary | Self-hosted, infra-heavy |
| SQLite | Yes | Yes | Yes | Yes | Yes | Optional/varies | No, graph DBs |
| Boot orientation report | Yes | Partial | Smart resume | Partial | Active context | No | No |
| Explicit gap detection | Yes | Not primary | Not primary | Not primary | Not primary | No | No |
| Orientation score | Yes | No/unclear | No/unclear | No | No | No | No |
| End-session capture ritual | Yes | Checkpoints | Checkpoints | Save/search | Active context updates | No | Episodes |
| Typed continuity records | Yes | Categories/priorities | Checkpoint fields | Memory/session docs | Structured project items | Memory schemas | Entities/facts/episodes |
| PreCompact / compaction hook | Yes | Compaction helper | Token guard / auto-checkpoint | No/unclear | No/unclear | No | No |
| Capture review tracking | Yes | No/unclear | No/unclear | No | No | No | No |
| Relational/process continuity | Yes, via `relational_delta` | Not primary | Personal AI OS/protocols | Agent instructions | Custom strategies | User memory | Possible in graph, not native ritual |
| Semantic search | Roadmap | Yes/unclear | FTS/tiered | Yes | Yes | Yes | Yes |
| Codebase indexing | No | File caching | File sync/context | Yes | Project context | No | No/direct |
| Background task queue | No | No | Yes | Daemon scanning | No | No | No |
| Cross-agent handoff | Not primary | Shared board | Yes | Cross-tool history | Export/import | Via app integration | Possible |
| Cloud sync | No | No/unclear | Remote bridge | Optional/possible | No | Yes | Zep managed |
| Beginner simplicity | High | High | Medium | Medium | Medium | Medium | Low-medium |

## What Rekindle Should Learn

### 1. The market already understands the pain

Multiple projects use nearly identical pain language:

- tired of re-explaining your project
- starts from zero every session
- context loss during compaction
- persistent memory across sessions
- pick up where you left off

This is good news. It means the problem is real.

It also means Rekindle's messaging must be sharper than generic memory/context persistence.

### 2. Rekindle's strongest unique phrase is still "orientation"

Most competitors say memory, context, search, resume, checkpoint, or restore.

Rekindle should keep saying:

- orientation
- continuity
- gap detection
- known missing context
- session closeout
- compaction survival

Those words make Rekindle less interchangeable.

### 3. Do not compete on number of tools

Some competitors expose 38 or 40+ tools. Rekindle has 10.

That is not a weakness if positioned correctly.

Rekindle should say:

> Rekindle is intentionally small. It focuses on the continuity loop: orient, capture, review, resume.

Tool count is a vanity metric if it makes the assistant harder to guide.

### 4. The PreCompact story is important

This may be Rekindle's most practical v0.3 differentiator.

A lot of tools talk about context loss between sessions. Fewer are focused on what gets flattened during mid-session compaction.

Recommended phrase:

> Rekindle protects both edges of the session: the cold start and the long middle.

### 5. Gap detection / absence awareness is the soul

Search tools tell the assistant what they found.

Rekindle should keep emphasizing that it also tells the assistant what may be missing.

Recommended phrase:

> Rekindle does not only load context. It reports the shape of the missing context.

That is different. Keep it.

### 6. Local-first simplicity is a moat

Several adjacent projects require API keys, cloud accounts, graph databases, Docker, Neo4j, OpenAI embeddings, or complex config.

Rekindle should stay proud of:

- `npx rekindle init`
- SQLite
- no API keys
- no telemetry
- no external services
- no dashboard required

This matters for trust and beginner adoption.

## Recommended Positioning

### One-sentence version

> Rekindle is a local MCP continuity engine that helps AI coding assistants orient at session start, survive compaction, and capture clean handoffs for the next session.

### Slightly longer version

> Most memory tools help an assistant search stored facts. Rekindle helps it resume responsibly: load identity and project state, surface open loops, capture compaction events, detect missing context, and close each session with a structured checkpoint for next time.

### Direct comparison sentence

> If memory tools answer "what can I retrieve?", Rekindle asks "am I oriented enough to continue?"

### Against direct competitors

> Rekindle is not trying to be the largest memory board or the broadest AI workbench. It is a focused continuity loop for Claude Code and other MCP clients: boot, detect gaps, capture, review, end, resume.

## README / Landing Page Recommendations

### Keep near the top

- `npx rekindle init`
- Local-first / no API keys
- Boot orientation
- PreCompact capture
- End-session closeout
- Gap detection

### Add or strengthen

A short comparison block:

```markdown
## Why Rekindle instead of a memory bank?

Memory banks store context.
Rekindle manages continuity.

It does four things most memory tools do not combine:

1. Starts each session with an orientation report.
2. Detects missing context instead of silently assuming recall is complete.
3. Captures the long middle before compaction flattens it.
4. Ends sessions with typed continuity records for the next boot.
```

A short warning against overclaim:

```markdown
Rekindle does not give an AI perfect memory. It gives the next session a better handoff.
```

### Avoid

- "No other tool does this."
- "Rekindle fixes AI forgetting."
- "Perfect continuity."
- "Self-awareness" as product language.

These are too easy to challenge. The actual product is strong enough without them.

## Search Terms to Monitor

Set up periodic GitHub/npm/PyPI searches for:

- `MCP memory server`
- `Claude Code memory`
- `Claude Code context`
- `AI session continuity`
- `persistent context MCP`
- `context memory MCP`
- `AI coding assistant memory`
- `compaction Claude Code memory`
- `PreCompact Claude Code`
- `agent memory sqlite`
- `local-first AI memory`
- `AI context manager`
- `context handoff AI`

## Next Research Pass

Recommended deeper checks:

1. Install and try `mcp-memory-keeper`.
2. Install and try `Continuum` if feasible.
3. Compare startup workflows side-by-side:
   - clean install
   - first memory/checkpoint
   - session restart
   - compaction/handoff behavior
4. Record screenshots or transcripts of each.
5. Create a user-facing comparison page only after hands-on testing.

Do not publish a direct competitor comparison yet. Internal first. Public later, and only with careful wording.

## Strategic Takeaway

Rekindle has a real lane, but it needs to stay disciplined.

The market already has memory stores, context banks, graph memory engines, and AI workbenches. Rekindle should not try to outgrow all of them.

The defensible lane is:

> A small, local, MCP-native continuity engine for AI coding sessions.

The loop is the product:

1. Orient at the start.
2. Name what is missing.
3. Capture before compaction.
4. Review what survived.
5. Close the session deliberately.
6. Resume with a better handoff.

That is still distinct. That is worth building.
