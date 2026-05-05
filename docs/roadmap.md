# Roadmap

## v0.1: "It remembered me" (current)

Local memory with orientation. The core loop: install, converse, store, boot next session, AI knows you.

- Memory MCP server with 6 tools (store, search, list, delete, update, boot_report)
- SQLite + FTS5 full-text search (zero external dependencies)
- Identity document template
- Orientation pipeline with gap detection
- Session capture hooks (transcript extraction, pre-compaction capture)
- Boot instruction template for CLAUDE.md

## v0.2: "It knows where it stands"

Orientation becomes the architecture, not just a feature. The system moves from "memory tools with a boot report" to "orientation engine backed by memory."

### Orientation domain layer

The core refactor. Extract orientation logic from boot-report.ts into a first-class domain:

```
src/orientation/
  OrientationService.ts    — orchestrates the full orientation pipeline
  GapDetector.ts           — structural gap detection (current + semantic)
  TranscriptReader.ts      — transcript discovery and reading
  IdentityReader.ts        — identity document loading
  OrientationRenderer.ts   — Markdown, JSON, future formats
  types.ts                 — OrientationResult, GapReport, OrientationScore
```

boot_report becomes a thin MCP tool that calls OrientationService and renders the result. The same orientation logic becomes available to CLI tools, tests, evals, and future UI.

### Structured output

OrientationService returns a typed object, not a formatted string:

```typescript
interface OrientationResult {
  identity: { loaded: boolean; path: string; content?: string };
  memories: { total: number; recent: number; byCategory: Record<string, number> };
  checkpoint: { exists: boolean; content?: string; age?: string };
  transcript: { exists: boolean; name?: string; preview?: string };
  gaps: GapReport[];
  score: number;
}
```

Markdown becomes one rendering target. JSON output enables tests, evals, and dashboards.

### Orientation score

A transparent, boring, measurable number:

```
Orientation Health: 85/100

+20  identity document loaded
+20  recent checkpoint exists
+20  transcript found
+15  recent memories exist (14 in last 7 days)
+10  relationship and preference categories populated
 -0  no gaps detected
```

Scoring is a simple weighted checklist. No mysticism. Users get a fast signal; we get something measurable over time.

### Richer memory metadata

New fields on the memory schema:

- `source` — who created this memory: `user`, `assistant`, `transcript`, `import`. A memory inferred by the assistant shouldn't carry the same weight as one the user explicitly stored. This is the single most important metadata addition.
- `session_id` — link memories to the session that created them. Enables "what changed last session?" and "which sessions had bad orientation?"
- `expires_at` — optional TTL for temporary context that shouldn't persist indefinitely.

### Sessions as first-class entities

Wire up the existing sessions table:

```sql
sessions
  id, project, started_at, ended_at, transcript_path,
  summary, checkpoint_memory_id, gap_count, orientation_score
```

Memories reference `session_id`. This unlocks: "which gaps repeat?", "which memories came from which session?", "what sessions had bad orientation?", "which memories are stale but still retrieved?"

### Config file

```json
// .rekindle/config.json
{
  "project": "my-project",
  "identity_path": ".rekindle/identity.md",
  "transcript_dir": ".rekindle/transcripts",
  "privacy": {
    "restrict_paths": true,
    "transcript_capture": true
  }
}
```

Replaces env vars and MCP tool parameters for common settings. Reduces user mistakes.

### Path security

Restrict file reads to the `.rekindle/` directory by default. Accept relative paths or configured paths, not arbitrary filesystem paths. Users can opt out via config, but the default should be safe. Memory tools become trust boundaries as adoption grows.

### Cloud storage adapter

Supabase + OpenAI embeddings for semantic search. Local SQLite stays as fallback. Semantic search augments FTS5 when cloud mode is active.

### Absence signaling

When a search query enters territory with no stored memories, report the absence. "You've never stored anything about X" is as valuable as "here's what you stored about X."

### Memory consolidation

Periodic pass over stored memories. Merge similar, promote frequently-retrieved, decay orphans. Five-criteria scoring: arousal, schema fit, retrieval frequency, distinctiveness, goal relevance.

## v0.3: "It thinks in networks"

Memory as a network, not a list. Retrieval follows associative paths.

- **Spreading activation**: When a memory is retrieved, activation spreads to related memories weighted by relationship strength, then decays based on distance from current focus. Surfaces connections keyword search can't find.
- **Relational reranking**: At retrieval time, memories reranked based on connections to other retrieved memories. A memory connected to three relevant memories ranks higher than an isolated keyword match.
- **Boot prep routine**: Pre-search based on recent activity, time of day, and active project before the human arrives. Boot report includes pre-fetched context.
- **Gap analysis tooling**: The reorientation pipeline (the research methodology behind the 43-session analysis) packaged as a tool. Measure your own AI's orientation quality over time.
- **Eval harness**: Regression test suite built from the 43-session dataset. Fixtures with known gaps, expected detection results, and orientation scores. "Rekindle catches X/Y known structural orientation failures."
- **Maintenance tools**: `review_memory_health`, `find_duplicate_memories`, `find_stale_memories`, `export_memories`, `import_memories`. Memory systems rot — these tools surface the rot.
