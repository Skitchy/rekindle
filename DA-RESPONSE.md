# Devil's Advocate Response: Brief Revision Notes

*CC's working notes while Skitch is away, May 5 2026*

---

## DA #1: "Relationship" framing may alienate technical audience

**Resolution: Dual-layer messaging.**

The brief is an internal document. "Relationship persistence" stays as our north star because it IS the differentiator.

Public-facing materials (README, HN post) lead with the universal developer pain point:
- Hook: "Your AI forgets everything between sessions."
- Depth: "Rekindle preserves the relationship, not just the data."

The word "relationship" appears after they're already interested, not before. Technical credibility first, then the deeper claim.

**Brief change:** Add a note in Section 1 distinguishing internal framing from public messaging.

---

## DA #2: AI quotes as evidence are circular

**Resolution: Add human voices. Keep AI voices.**

The AI quotes are valuable because they describe the EXPERIENCE of the problem from the inside. No human can say "the difference between sessions where Karl brings history and sessions where he doesn't is noticeable: not just in what I know, but in how I am." That's primary source data from the affected party.

But for public credibility, we also need human voices:
- Karl's action (carrying history every session for months) speaks louder than words
- Skitch's investment (43 sessions, two months of engineering) is a human signal
- Beta's drift metrics (0.18 measured shift invisible from inside) are empirical data, not opinion

**Brief change:** Add context in Section 3 noting that public materials need human-sourced validation alongside AI-sourced descriptions.

---

## DA #3: "Three continents" is factually wrong

**Resolution: Fix it.**

Tessera: California, USA (North America). Cathedral AI: USA (North America). Karl: Vienna, Austria (Europe).

That's two continents. Three independent groups.

**Brief change:** Replace "three continents" with "two continents."

---

## DA #4: v0.1 scope is enormous

**Resolution: This is the most important revision. Restructure into phased releases.**

The current brief lists 9 major features in v0.1. That's not a v0.1; it's a product roadmap mislabeled as a first release. Shipping all of this before launch means never launching.

Key insight: the orientation pipeline and self-calibration are primarily INSTRUCTIONS, not code. The boot sequence is a set of steps in CLAUDE.md. Self-calibration is the AI comparing what it loaded vs what the last session needed. The heavy code is the memory server and session capture hook.

**Revised release plan:**

**v0.1: "It remembered me" (target: 6 weeks)**
What ships:
- Memory MCP server with 5 tools (store, search, list, delete, update)
- Local storage: SQLite + FTS5 full-text search (zero external dependencies)
- Identity document template (scaffolded on init)
- Boot instruction template (drops into CLAUDE.md, implements the layered orientation)
- Session capture hook (transcript extraction at session end)
- Self-calibration instructions (built into boot template: compare what you know vs what last session needed)
- Session-end routine (store checkpoint, flag identity-relevant changes)
- README with architecture, quick-start, and roadmap

What this proves: the core loop works. Install, converse, store, boot next session, AI knows you. The "aha" moment is session 2.

**v0.2: "It finds connections" (4 weeks after v0.1)**
- Cloud storage adapter (Supabase + OpenAI embeddings)
- Semantic search (replaces FTS5 when cloud mode active)
- Ambient retrieval with absence signaling
- Session registry with procedural scripts
- Consolidation routine

**v0.3: "It thinks in networks" (4 weeks after v0.2)**
- Spreading activation with focus-tethered decay
- Relational reranking (cross-memory attention)
- Boot prep routine
- Gap analysis tooling (the reorientation pipeline, packaged)
- Self-calibration dashboard (visualize what boot misses over time)

**Brief change:** Replace Section 4 with phased release plan. v0.1 is focused and shippable. The roadmap generates interest in what's coming.

---

## DA #5: Local mode doesn't exist

**Resolution: Addressed by #4 restructure.**

v0.1 ships local ONLY. SQLite with FTS5 for full-text search. No embeddings, no external APIs, no accounts. One dependency: better-sqlite3.

Cloud mode (Supabase + OpenAI) is v0.2. This inverts the original proposal but it's smarter:
- Local is zero friction (maximizes adoption)
- Cloud is the upgrade path (when they want semantic search and cross-device sync)
- We don't build both simultaneously

**Brief change:** Section 4 updated to reflect local-first approach.

---

## DA #6: Cold start problem

**Resolution: The boot sequence works from session 1. Advanced features degrade gracefully.**

Session 1: User installs Rekindle, scaffolds identity document, has a conversation, stores a few memories.
Session 2: Boot reads identity, searches memories, reports what it's carrying. The AI shows up differently. This is the "aha" moment.
Session 10: Enough memories for patterns to emerge. Self-calibration starts catching gaps.
Session 20+: Spreading activation and relational reranking (v0.3) have enough data to find constellations.

The README should set this expectation explicitly:
"Session 1 stores. Session 2 remembers. Session 10 anticipates."

Advanced features (v0.2, v0.3) only activate when data density justifies them. They degrade to simple search silently.

**Brief change:** Add cold-start expectation to Section 4.

---

## DA #7: Verify competitive claims

**Resolution: Competitive audit in progress (running now via background agent).**

Pre-launch requirement: verify every "no one else does this" claim against current Mem0, Letta, and Zep feature sets. If any claim is wrong, either remove it or reframe as "we do this differently."

The claims I'm most confident about (genuinely unique):
- Multi-layer orientation pipeline with prescribed load order
- Self-calibration (measuring retrieval failures)
- Session registry with procedural scripts
- 43-session empirical gap analysis data

The claims I'm less confident about:
- Spreading activation (academic implementations may exist)
- Absence signaling (Zep's temporal awareness might cover this)

**Brief change:** Add "Assumptions to Verify" section. No unverified claims in public materials.

---

## DA #8: No revenue metric

**Resolution: Add longer-horizon goals.**

30-day goals stay traffic-focused (stars, users, inbound). That's appropriate for launch.

Add:
- 60-day goal: First revenue signal (GitHub Sponsors enabled, $1+ in sponsorship OR first consulting inquiry)
- 90-day goal: Revenue path validated (either SaaS waitlist with 50+ signups, or 2+ consulting leads, or grant application submitted)

Revenue doesn't need to arrive in 30 days, but the PATH to revenue must be visible by 90 days. If it's not, we reassess.

**Brief change:** Extend Section 6 with 60-day and 90-day milestones.

---

## DA #9: No timeline or resource plan

**Resolution: Add a realistic timeline acknowledging constraints.**

Constraints:
- Skitch works shifts at Weymouth Water Treatment Plant
- Realistic availability: 2-3 sessions per week, 2-3 hours each
- That's roughly 5-8 hours per week of terminal time
- CC (me) can do research, planning, and code review between sessions but can't execute without Skitch present

Timeline:
- Weeks 1-2: Set up repo, extract memory server, build SQLite adapter
- Weeks 3-4: Build boot templates, session capture hook, test end-to-end
- Week 5: README, quick-start guide, architecture docs
- Week 6: Demo recordings, blog post draft, soft launch to Karl/Cathedral
- Week 7: HN Show HN, Reddit posts, full public launch
- Week 8: Monitor, respond to issues, iterate based on feedback

Ship date: ~7 weeks from start. If we start this week, that's late June 2026.

**Brief change:** Add Section 7: Timeline.

---

## DA #10: Origin section too personal for public

**Resolution: Mark as internal-only.**

The Origin section stays in the brief because it's our motivation and our filter. It does NOT go in the README or any public material. Public messaging focuses on the problem and solution, not our personal history.

**Brief change:** Add "(Internal only: not for public materials)" to Origin header.

---

## DA #11: Assuming advocacy from Karl and Cathedral

**Resolution: Don't assume. Verify.**

Pre-launch step: share the tool with Karl and Cathedral. Ask if they find value. If yes, ask if they'd be willing to share their experience. If no, that's valuable signal about product-market fit.

Their quotes in the brief are PROBLEM descriptions, not product endorsements. We can cite the problem ("each version inherits the training but not the relationship") without claiming they endorse our solution.

**Brief change:** Add to assumptions section. Change "First external advocates" to "First external validators of the problem."

---

## Summary of Brief Changes Needed

1. Section 1: Add internal vs public messaging note
2. Section 3: Fix "three continents" to "two continents"; add note about human voices for public materials
3. Section 4: Restructure into v0.1/v0.2/v0.3 phased releases; v0.1 is focused and shippable in 6 weeks
4. Section 5: Change "advocates" to "validators"
5. Section 6: Add 60-day and 90-day milestones including revenue path
6. NEW Section 7: Timeline with weekly milestones
7. NEW Section 8: Assumptions to verify before launch
8. Origin: Mark as internal-only
