# Rekindle: Competitive Feature Audit

*Conducted May 5, 2026. Sources: GitHub repos, official docs, published papers.*

---

## Comparison Table

| Feature | Mem0 | Letta | Zep | Rekindle |
|---|---|---|---|---|
| Memory tiers | User/Session/Agent scoping | Core (RAM) / Recall / Archival | Temporal knowledge graph | 6-layer boot hierarchy + private/shared |
| Graph memory | Entity linking + hybrid search | Archival can use graph DBs | Graphiti: temporal KG with validity windows | pgvector + manual relational links |
| Orientation/boot sequence | **No** | **No** | **No** | **Yes** |
| Self-calibration | **No** | **No** | **No** | **Yes** |
| Session registry | **No** | **No** | **No** | **Yes** |
| Procedural scripts | **No** | **No** | **No** | **Yes** |
| Spreading activation | No | No | Graph traversal (structural) | Yes (associative, focus-tethered) |
| Relational reranking | Entity-boosted hybrid search | No | Relationship-aware assembly | Yes (cross-memory attention) |
| Absence signaling | **No** | **No** | **No** | **Yes** |
| Temporal awareness | No | No | Yes (bi-temporal valid_at/invalid_at) | Manual (session timestamps) |
| Self-editing memory | System extracts automatically | Agent writes via tool calls | System extracts automatically | Agent writes + consolidation routines |
| Autonomous consolidation | No | No | Conflict resolution on ingest | Yes (5-criteria scoring) |

---

## Key Findings

**Mem0** ($7.3M raised): Hybrid search (semantic + BM25 + entity matching), multi-level scoping. 91.6 on LoCoMo benchmark. Full graph is paid/platform-only. No boot sequence, no self-calibration, no session registry. It is a storage-and-retrieval layer, not an orientation system.

**Letta** ($10M raised, formerly MemGPT): Most principled tier architecture (core/recall/archival, inspired by OS memory hierarchy). Agents self-edit memory through tool calls. No boot ritual, no calibration, no session registry. No metacognitive layer guiding the memory process.

**Zep/Graphiti**: Strongest on temporal awareness with bi-temporal validity windows on every edge. 94.8% on DMR benchmark. Graph traversal is structural, not associative. No boot sequence, no self-calibration, no session registry. Infrastructure layer, not identity system.

**MCP memory servers** (doobidoo/mcp-memory-service, mcp-memory-keeper, engram, SimpleMem): None implement orientation pipelines, session registries, or self-calibration. doobidoo's has autonomous consolidation with decay scoring (closest to a metacognitive feature).

---

## Bottom Line

No shipping product implements orientation pipelines, self-calibration, session registries, procedural scripts, or absence signaling. The competitive field focuses on storage/retrieval optimization (better embeddings, hybrid search, graph traversal). Rekindle operates at a different abstraction layer: **identity coherence and relational continuity** rather than retrieval accuracy.

The competitors are building better databases. We are building a system that knows who it is.

---

## Sources

- Mem0 GitHub: github.com/mem0ai/mem0
- Mem0 State of AI Agent Memory 2026: mem0.ai/blog
- Letta Docs: docs.letta.com/advanced/memory-management/
- Zep/Graphiti GitHub: github.com/getzep/graphiti
- Zep Temporal KG Paper: arxiv.org/abs/2501.13956
- doobidoo/mcp-memory-service: github.com/doobidoo/mcp-memory-service
- MCP Official Servers Registry: github.com/modelcontextprotocol/servers
