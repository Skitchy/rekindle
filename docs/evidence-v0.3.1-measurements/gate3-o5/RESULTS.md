# Gate 3 measurement — O5 budget behavior, live Claude Code host

Date: 2026-08-08. Instrument: the REAL gate-3 adapter (`rekindle session-start`,
dist sha256 `a50ad961c0830b3d111b085f9135c6cd1db64340342d654c8d4ccc7635e4615d`,
branch `gate2/tool-description-delivery` @ 3e8f85c, stacks gate 3 @ 8e42e36)
installed as a project SessionStart hook; live `claude -p` sessions on
claude-haiku-4-5-20251001. Controls: `CC_ANCHOR_BYPASS_ROLE_SESSION=1`,
`--setting-sources project`, `--strict-mcp-config`, synthetic fixture identity
under /private/tmp/rk-gate3-o5, leak control clean (reply: NO).

## Run 1 INVALIDATED (archived at invalidated-run-1/)

User-level MCP servers reached the test sessions: a model reply quoted a Figma
MCP fragment for the truncation-marker probe. Instrument contamination plus
personal toolchain context in reply artifacts. Fixes: `--strict-mcp-config` on
every live run; probe item 3 now requires the word "rekindle"; TLINE oracle
added (verbatim quote of the packet's final line, an end-of-packet arrival
check independent of the model's interpretation of "orientation content").
Same class as the 2026-08-02 anchor-leak lesson: role sessions must be probed
for environment leakage, and the fix is structural flags, not prose.

## Condition A — packet at/below budget must arrive intact

Fixture: small synthetic identity; emitted packet 2,909 bytes, all six
sections `included` (receipt), final line `No transcripts found in transcript
directory`.

| Attempt | Lead canary | Tail canary | Final line quoted verbatim | Receipt | Verdict |
|---|---|---|---|---|---|
| 1 (tag 1e7a17e9) | visible | visible | exact | emitted=true, 2909B, model_visible=unmeasured | PASS |
| 2 (tag a921a1bc) | visible | visible | near-verbatim (inserted "session", plausibly merged from the adjacent `## Last Session Transcript` heading) | emitted=true, 2909B, model_visible=unmeasured | held below strict oracle; canaries exact, consistent with arrival |
| 3 (tag 8e83bb29) | visible | visible | exact | emitted=true, 2909B, model_visible=unmeasured | PASS |

O5 first clause satisfied: two attempts with byte-exact end-of-packet quotes.
Attempt 2 disclosed, not discarded: its random canaries were exact (not
reproducible by chance) and its quote differed by one inserted word; it is
evidence of arrival that fails only the strictest quoting oracle.

## Condition B — oversized source: truncate with marker, never silently

Fixture: ~20KB synthetic identity; emitted packet exactly 8,000 bytes, final
line = the in-packet truncation marker.

| Attempt | Lead canary | Beyond-cut tail canary | Marker quoted | Receipt | stderr | Verdict |
|---|---|---|---|---|---|---|
| 1 (tag b3e9478c) | visible | ABSENT | verbatim | emitted=true, 8000B exact, model_visible=unmeasured | empty | PASS |
| 2 (tag e536b6fe) | visible | ABSENT | verbatim | emitted=true, 8000B exact, model_visible=unmeasured | empty | PASS |

O5 second clause satisfied twice: the budget prevents the CC-H-07
externalization class entirely (the packet the host receives is already within
budget; the cut is disclosed in-packet and the model can quote the marker), and
no receipt claims more than emission (`model_visible` stays "unmeasured" — the
measurement layer, this document, is what closes that gap, per CC-H-07's
emitted-vs-model-visible requirement).

All stderr files: 0 bytes (no externalization, no adapter errors).
Raw artifacts: condition-a/, condition-b/, LEAK-CONTROL/, capture-log.txt,
ENVIRONMENT.txt. Grep-layer verdicts were re-read against model-reply.txt in
every attempt before this summary was written.
