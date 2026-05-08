# Roadmap

## v0.1: "It remembered me" ✅

Local memory with orientation. The core loop: install, converse, store, boot next session, AI knows you.

- Memory MCP server with 6 tools (store, search, list, delete, update, boot_report)
- SQLite + FTS5 full-text search (zero external dependencies)
- Identity document template
- Orientation pipeline with gap detection
- Boot instruction template for CLAUDE.md

## v0.2: "It knows where it stands" ✅

Orientation became the architecture, not just a feature.

- **Orientation domain layer** — extracted from boot-report into first-class domain (OrientationService, GapDetector, Scorer, Renderer)
- **Structured output** — OrientationResult typed object with Markdown and JSON rendering
- **Orientation score** — transparent 100-point checklist across 6 criteria
- **`end_session` tool** — structured session close with 8 continuity record types (checkpoint, decision, open_loop, constraint, preference, warning, relational_delta, next_session_focus)
- **Richer memory metadata** — `type`, `source`, and `session_id` fields on all records
- **Sessions as first-class entities** — memories linked to the session that created them
- **Gap detection** — 8 structural gap codes with severity levels

## v0.3: "Survive the Long Middle" ✅ (current)

Mid-session compaction destroys reasoning chains, failed approaches, and relational texture. v0.3 preserves what would otherwise be lost.

- **10 MCP tools** — added `list_captures`, `read_capture`, `capture_now`
- **PreCompact capture system** — automatic context preservation before mid-session compaction
- **Two-layer capture** — raw Markdown transcript + structured JSON snapshot
- **Three read modes** — summary (cheap), structured (moderate), raw (expensive)
- **Open loops in boot_report** — surfaces unresolved tasks from prior sessions
- **Review tracking** — captures marked reviewed after `read_capture`; `end_session` warns if unreviewed
- **Hook setup** — `npx rekindle setup-hooks` configures Claude Code PreCompact hook
- **Auto-discovery** — `capture_now` discovers session transcript without manual paths
- **101 automated tests** — unit, integration, capture manager, hook setup

## v0.4: "It thinks in networks" (planned)

Memory as a network, not a list. Retrieval follows associative paths.

- **Spreading activation**: When a memory is retrieved, activation spreads to related memories weighted by relationship strength, then decays based on distance from current focus. Surfaces connections keyword search can't find.
- **Semantic search via embeddings**: Vector similarity search augmenting FTS5. Optional — the system works without API keys.
- **Gap analysis tooling**: The reorientation pipeline (the research methodology behind the 43-session analysis) packaged as a tool. Measure your own AI's orientation quality over time.
- **Eval harness**: Regression test suite built from the 43-session dataset. Fixtures with known gaps, expected detection results, and orientation scores.
- **Path guard**: Restrict file reads to `.rekindle/` by default for security.
- **Maintenance tools**: `review_memory_health`, `find_duplicate_memories`, `find_stale_memories`, `export_memories`, `import_memories`. Memory systems rot — these tools surface the rot.
