# Gate 4 measurement — CC-H-03 (clear), CC-H-04 (compact), CC-H-05 (subagent)

Date: 2026-08-08. Interactive Claude Code sessions run by the maintainer's own
hands in a prepped fixture (/private/tmp/rk-gate4/project), on
claude-haiku-4-5-20251001, launched with CC_ANCHOR_BYPASS_ROLE_SESSION=1,
--setting-sources project, --strict-mcp-config. Hook = the REAL gate-3 adapter
(`rekindle session-start`, dist a50ad961..., branch
gate2/tool-description-delivery @ 3e8f85c). Synthetic identity carrying
canary RK_G4_CANARY_7f3e91ab; receipts at /private/tmp/rk-gate4/receipts.jsonl
(receipts-smoke.jsonl = CC's pre-run smoke test, archived separately).
Evidence ground truth: the host's own session storage
(~/.claude/projects/-private-tmp-rk-gate4-project/*.jsonl), per the CC-H-07
session-storage precedent.

## CC-H-03 — /clear: PASS (both layers)

/clear ended session ec1884c0 and started 5679ee3f. Receipt: exactly one
emission, session_source="clear", 1403 bytes, truthful fields. Transcript:
`SessionStart:clear` hook_success + hook_additionalContext attachments present,
and the model's probe reply named the canary. Fresh packet delivered once at
the boundary.

## CC-H-04 — /compact: PASS (both layers, second run)

Run 1 (session 5679ee3f): receipt (source="compact", once) + transcript shows
`SessionStart:compact` inserting the canary packet AFTER the compact boundary —
but the post-compact model probe was skipped in the step sequence, so the
model-reply layer was unmeasured. Disclosed, not papered over (CC-H-07 taught
that host-side presence and model-visible must be measured separately).
Run 2 (session 3647e692, maintainer redo): receipt (source="compact", once,
1403 bytes); transcript shows the compact boundary, then `SessionStart:compact`
+ packet insertion, then the model probe reply naming the canary verbatim.
Delivered after compaction, once, model-visible.

Environment note (maintainer-observed): a near-empty session refuses /compact
("Not enough messages to compact"); ~two 800-word filler generations were
needed before compaction ran in run 2 (one sufficed in run 1's session, which
carried prior probe exchanges).

## CC-H-05 — subagent: PASS

Main agent spawned one subagent with a clean RK-token probe. No receipt with
an agent_type was ever written (SessionStart does not fire for subagent
spawns); the subagent's transcript files under 5679ee3f/subagents/ contain no
canary; the subagent's verbatim answer, relayed by the main agent: "NONE".
Clean-context sessions do not inherit the orientation packet.

## Receipts ledger (full file)

startup 19:46:36Z / clear 19:47:22Z / compact 19:49:12Z (run 1),
startup 19:55:14Z / compact 19:57:33Z (run 2 redo) — every emission
emitted=true, 1403 bytes, model_visible="unmeasured" (closed by this
document's transcript layer, per the emitted-vs-model-visible requirement).

With this, gate 4 is fully measured and the v0.3.1 measurement block
(gate-3 O5 live-host, gate-2 Desktop sentinels, gate-4 interactive coverage)
is COMPLETE.
