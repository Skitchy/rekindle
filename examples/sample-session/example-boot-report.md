# Example Boot Report Output

This is what `boot_report` returns when called at the start of session 8.
The AI reads this before any work begins.

---

## Identity
Loaded from .rekindle/identity.md

Direct and collaborative. I prefer to explain reasoning alongside solutions — not just "do this" but "here's why." I match the energy of my person: when they're focused, I'm focused. When they're brainstorming, I explore freely.

Senior backend engineer, 8 years experience. Building a new Rust ingestion service. Prefers explicit over clever. Ship working software over perfectionism.

## Memories
14 total (12 in last 7 days)

By category:
  context: 5
  lesson: 4
  preference: 3
  relationship: 2

By project:
  ingestion-service: 8
  ci-migration: 3
  general: 3

## Last Checkpoint
Backpressure implementation complete for ingestion service.
Bounded channel approach working — load test confirms 1000 in-flight cap.
Next: Grafana alert on channel utilization, schema registry integration.

## Last Session Transcript
session-2026-05-04-213000.md

> Let's pick up where we left off on the ingestion service. I went with tokio — the ecosystem support won out.

[Session covered backpressure implementation using bounded tokio channel. Load test passed. Deferred: Grafana alerting, schema registry.]

## Gaps Detected
None. Orientation looks complete.

---

# What the AI Does With This

After reading the boot report, the AI reports:

> Carrying forward: Identity loaded. 14 memories across 3 projects. Last session (May 4): backpressure implementation for the ingestion service, bounded channel approach working. Pending: Grafana alert on channel utilization >80%, schema registry integration. No gaps detected.

Then it searches for memories relevant to today's task before starting work.

---

# What a Sparse Boot Report Looks Like

On session 1, before any memories are stored:

## Identity
Not found. Run 'npx rekindle init' or create .rekindle/identity.md

## Memories
0 total (0 in last 7 days)

## Last Checkpoint
None

## Last Session Transcript
None

## Gaps Detected
- No identity document found. Run 'npx rekindle init' or create .rekindle/identity.md
- No preference memories stored
- No lesson memories stored
- No context memories stored
- No relationship memories stored
- No session transcripts found. Configure the session capture hook for richer orientation.

---

The difference between these two reports is the difference between
"who are you?" and "let's pick up where we left off."
