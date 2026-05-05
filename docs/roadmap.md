# Roadmap

## v0.1: "It remembered me" (current)

Local memory with orientation and self-calibration. The core loop: install, converse, store, boot next session, AI knows you.

- Memory MCP server with 6 tools (store, search, list, delete, update, boot_report)
- SQLite + FTS5 full-text search (zero external dependencies)
- Identity document template
- Orientation pipeline with gap detection
- Session capture hooks (transcript extraction, pre-compaction capture)
- Boot instruction template for CLAUDE.md

## v0.2: "It finds connections"

Cloud storage and semantic search. Cross-device sync. The system starts noticing what's missing.

- **Cloud storage adapter**: Supabase + OpenAI embeddings. Keeps local SQLite as fallback. Semantic search replaces FTS5 when cloud mode is active.
- **Ambient retrieval with absence signaling**: After the human's first substantive message each session, the system automatically searches for related memories. When a query enters territory with no stored memories, the system reports the absence. "You've never stored anything about X" is as valuable as "here's what you stored about X."
- **Session registry**: Compressed session entries with three layers: episodic (what happened), semantic (what was learned), and procedural (if-then relational rules). Procedural scripts encode patterns like "if the human mentions X, it usually means Y" that can't be stored as simple facts.
- **Consolidation routine**: Periodic pass over stored memories. Merge similar memories, promote frequently-retrieved ones, decay memories with no retrievals and no schema connections. Five-criteria scoring: arousal, schema fit, retrieval frequency, distinctiveness, goal relevance.

## v0.3: "It thinks in networks"

Memory as a network, not a list. Retrieval follows associative paths.

- **Spreading activation with focus-tethered decay**: When a memory is retrieved, activation spreads to related memories (weighted by relationship strength), then decays based on distance from the current focus. Surfaces connections the AI wouldn't find through keyword search alone.
- **Relational reranking**: At retrieval time, memories are reranked based on their connections to other retrieved memories. A memory that connects to three other relevant memories ranks higher than an isolated memory with the same keyword match.
- **Boot prep routine**: Before the human arrives, the system pre-searches based on recent activity, time of day, and active project. Boot report includes pre-fetched context so orientation is faster.
- **Gap analysis tooling**: The reorientation pipeline (the research methodology that produced the 43-session gap analysis) packaged as a tool. Measure your own AI's orientation quality over time.
