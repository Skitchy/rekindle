# Gate 2 measurement — Desktop tool-description delivery (sentinel probe)

Date: 2026-08-08. Desktop app v1.26832.0 (pre-relaunch build), rekindle build
branch `gate2/tool-description-delivery` @ 76dfa6f (dist/index.js as configured
in config-used.json), server env HOME=/private/tmp/rk-gate2-desktop/home.
Config swapped by jq merge and RESTORED byte-identical (sha256 3aae3a33...,
capture-log.txt). Probes typed into real Home-tab chats (model shown: Fable 5);
two fresh chats, each probed at both stages. Window-scoped captures
(capture-window.sh); sidebar-visible captures are working files, withheld
class — publishable derivatives need the message-pane crop.

## Finding: Desktop now DEFERS full tool descriptions

**Stage 1 (listing time, no tool use) — the four Workflow sentinels are NOT
model-visible.** Both attempts: the model sees all 10 rekindle tool names but
only one-line truncated summaries (attempt 2 enumerated each one verbatim —
they are the first sentence of each base description). The appended Workflow
fragments are beyond the truncation, therefore structurally invisible at
listing time. Server-level `instructions`: ABSENT both attempts (CD-M-01
reproduced on the current app).

**Stage 2 (after the model runs its native tool-search on rekindle) — all four
sentinels arrive verbatim.** Both attempts quoted the Workflow sentences for
end_session, list_captures, boot_report, read_capture, attributed to the right
tools, matching WORKFLOW_GUIDANCE (guidance.ts) word-for-word.

## Interpretation against the ratified gate

The gate's origin finding (CD-M-01: guidance must ride tool descriptions
because `instructions` is never model-visible) remains true, but the current
Desktop adds a second gate in front of descriptions: a deferred-tool listing
that truncates every description to its first sentence until the model chooses
to load full definitions. Measured consequences for the delivery contract:

1. Tool descriptions are still the ONLY channel that can reach the Desktop
   model (instructions confirmed absent again) — gate-2 implementation rides
   the right channel.
2. Delivery is two-stage: names + first sentences always; full descriptions
   (with Workflow fragments) only post-load. Any public claim must say
   "reachable via the model's tool-search", not "visible at session start".
3. Contract implication for v0.3.1 docs/criteria (Ari should see this at
   REVIEW-READY): the first sentence of each tool description is the only
   always-visible text — it must carry enough cue for the model to load the
   full definition when orientation matters.

## Evidence inventory

- view-05..view-14 PNGs: launch state, both probes, both stages, both attempts
  (view-01..04 are navigation working files; view-01/-04 contain the Code-tab
  personal environment — WITHHELD class, never publish).
- mcp-server-rekindle.full.log: handshake + tools/list on the gate-2 build at
  Desktop's cwd=/ (gate-1 resolver reconfirmed live).
- capture-log.txt: pre/post config hashes, restore verification.
- Chats used: two "MCP server tools and instructions query" conversations in
  the maintainer's account, Aug 8 2026 (deletable; content is synthetic probe
  text only).
