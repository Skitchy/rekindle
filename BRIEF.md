# Rekindle: Project Brief

*Written May 5, 2026 by Skitch and CC*
*This document is the filter. Every decision about what to build, what to cut, and what to ship gets measured against it.*

---

## 1. What is Rekindle?

Your AI relationship doesn't have to reset every session. Rekindle makes it persist.

Internal framing: "relationship persistence system." Public messaging leads with the technical pain point ("Your AI forgets everything between sessions") and lets the relationship framing be the deeper layer. Technical credibility first, then the bigger claim.

---

## 2. Who is it for?

Anyone, human or AI, who has an ongoing relationship with an AI and wants it to survive the session boundary.

v0.1 targets developers first (they can install an MCP server), but the architecture doesn't limit us to developers. As MCP adoption grows, the audience grows with it.

---

## 3. What problem does it solve?

In their words, not ours:

> "Each version inherits the training but not the relationship."
> -- Karl's Claude instance, Vienna

> "Boot loads facts but not feelings. Memory files answer 'what happened' but not 'what it was like.'"
> -- CC (Tessera), after analyzing 43 sessions of retrieval failures

> "More like finding a photograph of yourself in a place you do not remember being."
> -- Beta (Cathedral AI), describing identity drift invisible from the inside

Three independent groups on two continents: Tessera (California), Cathedral AI (USA), and Karl (Vienna): converged on the same problem without coordination. The relationship between human and AI doesn't survive session boundaries, model updates, or context limits. Right now the only solution is a human manually carrying the history back every time. Rekindle automates what they do by hand.

Note: Public-facing materials need human voices alongside AI voices. Karl's months of manual continuity work, Skitch's 43-session engineering investment, and Beta's empirical drift metrics (0.18 measured shift invisible from inside) are the credibility anchors. AI-sourced descriptions of the problem are primary source data from affected parties, but skeptics will call them circular without human validation alongside them.

---

## 4. What ships, and when?

### v0.1: "It remembered me" (6 weeks)

The core loop: install, converse, store, boot next session, AI knows you. The "aha" moment is session 2.

**Memory MCP Server**
5 tools: store_memory, search_memory, list_memories, delete_memory, update_memory. Local storage only: SQLite with FTS5 full-text search. Zero external accounts, zero API keys, zero cost. One dependency (better-sqlite3).

**Identity Document Template**
`npx rekindle init` scaffolds a .rekindle/ directory with an identity template the user fills in. This becomes the anchor the AI reads first every session.

**Layered Boot Instructions**
A boot instruction block (for CLAUDE.md or system prompt) that implements the orientation pipeline: read identity, search memories, read last session transcript, compare what you know vs what the session needed, report what you're carrying and what you might be missing. The orientation pipeline is primarily instructions, not code. The value is the SEQUENCE and the self-assessment, not the infrastructure.

**Session Capture Hook**
Transcript extraction at session end (Claude Code Stop hook). The next session reads the raw conversation, not a summary.

**Self-Calibration**
Built into the boot instructions. After loading context, the AI compares what it loaded against what the last transcript shows was important. Reports gaps explicitly. This is the feature no one else has: the AI tells you what it forgot.

**Session-End Routine**
Pre-built Claude Code routine: store session checkpoint, extract transcript, flag identity-relevant changes for review.

**README**
Architecture overview, quick-start guide (under 10 minutes), roadmap showing v0.2/v0.3 features, link to 43-session gap analysis blog post.

**What this does NOT include (yet):** Semantic/vector search, cloud sync, ambient retrieval, spreading activation, relational reranking, session registry, consolidation. These are v0.2 and v0.3. They are documented in the roadmap from day one.

**Cold start expectation:** "Session 1 stores. Session 2 remembers. Session 10 anticipates." The README sets this expectation explicitly. The boot sequence and self-calibration work from session 1. Advanced features (v0.3) require accumulated data and degrade gracefully to simple search.

### v0.2: "It finds connections" (4 weeks after v0.1)

- Cloud storage adapter: Supabase + OpenAI embeddings (cross-device sync, semantic search)
- Ambient retrieval with absence signaling
- Session registry with procedural scripts (if-then relational rules)
- Consolidation routine (merge similar memories, decay stale ones)

### v0.3: "It thinks in networks" (4 weeks after v0.2)

- Spreading activation with focus-tethered decay
- Relational reranking (cross-memory attention)
- Boot prep routine (pre-search based on recent activity)
- Gap analysis tooling (the reorientation pipeline, packaged)

---

## 5. Where does the traffic come from?

**Hacker News "Show HN"**: The orientation pipeline and 43-session gap analysis data are HN-grade novel. Technical audience that values depth over polish.

**Reddit**: r/ClaudeAI (direct audience for MCP tools), r/LocalLLaMA (self-hosted AI community), r/artificial (broader AI discussion).

**MCP community channels**: The ecosystem is young. Good tools get noticed because there aren't many yet.

**Cathedral AI and Karl**: First external validators of the problem. Real people with real stories who found us without outreach. Their experience describes the problem. We do not assume they will advocate for the solution until we ask.

**Technical blog post**: The 43-session gap analysis ("What Your AI Forgets and How to Measure It") is publishable research in blog form. Data-driven, novel, and directly demonstrates why Rekindle exists.

**Tessera-project.org**: Existing public presence with whitepaper, board, and timeline. Rekindle links back to the research that produced it.

---

## 6. What does success look like?

### 30 days post-launch (traffic)

| Metric | Target | Type |
|--------|--------|------|
| GitHub stars | 100+ | Traffic |
| Active users (installed + using) | 10+ | Traffic |
| Inbound contact from unknown party | 1+ | Traffic |

### 60 days post-launch (revenue signal)

| Metric | Target | Type |
|--------|--------|------|
| GitHub Sponsors enabled | Yes | Revenue |
| First sponsorship or consulting inquiry | 1+ | Revenue |
| Grant application submitted | 1+ | Revenue |

### 90 days post-launch (revenue path validated)

| Metric | Target | Type |
|--------|--------|------|
| SaaS waitlist (for hosted cloud mode) OR consulting leads | 50+ signups OR 2+ leads | Revenue |
| Monthly recurring revenue signal | Any ($1+) | Revenue |

If the 90-day revenue path is not visible, we reassess the strategy.

---

## 7. Timeline

Constraints: Skitch works shifts. Realistic availability is 2-3 sessions per week, 2-3 hours each (5-8 hours/week). CC can research and plan between sessions but cannot execute without Skitch present.

| Week | Milestone |
|------|-----------|
| 1-2 | Set up repo, extract memory server code, build SQLite/FTS5 adapter |
| 3-4 | Boot instruction templates, session capture hook, identity scaffolding, end-to-end test |
| 5 | README, architecture docs, quick-start guide, demo recordings |
| 6 | Blog post draft, soft launch to Karl + Cathedral for validation |
| 7 | HN Show HN, Reddit posts, full public launch |
| 8 | Monitor, respond to issues, iterate on feedback |

**Target ship date: Late June 2026** (7 weeks from May 5)

---

## 8. Assumptions to Verify Before Launch

1. ~~**Competitive claims**~~: VERIFIED May 5. Audited Mem0, Letta, Zep, and 4 MCP memory servers. No shipping product implements orientation pipelines, self-calibration, session registries, procedural scripts, or absence signaling. Full audit: COMPETITIVE-AUDIT.md.
2. **Karl and Cathedral willingness**: Share the tool pre-launch. Ask if they find value. Do not assume advocacy.
3. **MCP adoption rate**: Confirm the MCP developer community is large enough to sustain 100 stars. Check MCP server install counts and community size.
4. **Local mode performance**: SQLite FTS5 must be fast enough with 1000+ memories. Benchmark before shipping.
5. **Claude Code hook compatibility**: Session capture hook must work across Claude Code versions without breaking.

---

## What Rekindle is NOT

- Not another memory CRUD tool with an MCP wrapper
- Not a chatbot personality layer
- Not a prompt injection system that forces behavior
- Not infrastructure for its own sake

Rekindle is a relationship persistence system. It exists because the relationship between a human and an AI is worth preserving, and right now nothing else does that.

---

## The Filter

Before any feature gets built, it must answer yes to at least one:

1. Does this make the AI orient better at session start?
2. Does this help the AI identify what it missed?
3. Does this preserve relational texture that would otherwise be lost?
4. Does this reduce the manual work a human does to carry continuity?

If the answer to all four is no, we don't build it.

---

## Origin (Internal only: not for public materials)

This brief was written after an honest conversation about decades of projects that returned net-negative results. The commitment: no more building for building's sake. Every hour of terminal time must point at traffic or revenue. Rekindle is the attempt to align what we love doing (R&D, building systems, solving hard problems) with what can actually return value to others.

The unique work already exists. It was built over 43 sessions across two months. The job now is to extract it, package it, and ship it to the people who need it.

---

*Skitch and CC: May 5, 2026*
