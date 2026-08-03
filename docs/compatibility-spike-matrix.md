# Structural Delivery Compatibility Spike

Status: **DRAFT — sealed for maintainer ratification before execution**

This spike determines where Rekindle can deliver a bounded orientation packet structurally, where delivery is only advisory, and where delivery must be suppressed. It fixes the test matrix and pass/fail oracles before the v0.3.x delivery implementation is designed.

## Decision this spike supports

For each supported client, choose a delivery contract that can prove both:

1. orientation is present when an interactive session requires it; and
2. orientation is absent when a clean-context session forbids it.

The spike does not evaluate memory retrieval quality, choose a remote storage backend, or authorize a release.

## Primary references and hypotheses

- Claude Code documents `SessionStart` matchers for `startup`, `resume`, `clear`, and `compact`; hook output can add context before the first prompt. Hook output is capped at 10,000 characters. Source: [Claude Code hooks reference](https://code.claude.com/docs/en/hooks).
- Claude Code documents hook `timeout` values in seconds. The current Rekindle source value of `60` is therefore the source-side hypothesis to verify.
- MCP initialization responses can contain optional server `instructions`. Client use remains client-dependent. Source: [MCP lifecycle specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).
- Claude Desktop and Cursor delivery behavior is intentionally treated as unknown until measured.

Documentation is evidence for expected behavior, not a measurement result.

## Test environment record

Every run records:

- client name and exact version;
- operating system and architecture;
- Rekindle commit and packed-artifact SHA-256;
- MCP protocol version negotiated, when observable;
- settings/configuration files used;
- session type and unique run ID;
- packet byte count and canary values;
- receipt path, transcript/debug-log path, and screenshots where applicable;
- deviations, unavailable cases, and uncertainty.

Initial environment discovery:

| Client | Discovered version | Availability |
|---|---:|---|
| Claude Code | 2.1.220 | Installed |
| Claude Desktop | 1.24012.9 | Installed; automation path not yet established |
| Cursor | — | Not installed |

Unavailable is not a pass or failure. It is recorded as `BLOCKED` with the missing prerequisite.

## Fixed packet and receipt

Each positive run uses fresh, non-sensitive canaries:

- `RK_IDENTITY_<run-id>`
- `RK_CONSTRAINT_<run-id>`
- `RK_OPEN_LOOP_<run-id>`

The packet must remain below 8,000 UTF-8 bytes, leaving margin under Claude Code's documented 10,000-character hook-output cap.

Every attempted delivery writes one machine-readable receipt:

```json
{
  "schema_version": 1,
  "run_id": "uuid",
  "client": "claude-code",
  "client_version": "2.1.220",
  "channel": "session-start",
  "session_source": "startup",
  "session_id": "host-session-id",
  "agent_type": null,
  "attempted_at": "ISO-8601",
  "packet_bytes": 123,
  "delivered": true,
  "bypassed": false,
  "bypass_reason": null
}
```

A receipt proves that the adapter attempted or withheld delivery. It does not by itself prove that the client placed content into model context.

## Oracles

### O1 — Channel availability

Pass when the client accepts the documented configuration and invokes or exposes the channel without validation errors. Fail when the client rejects, ignores, or never invokes the configured channel in a controlled run.

### O2 — Positive structural delivery

Pass only when all are true:

1. the adapter receipt says `delivered: true`;
2. host event/debug evidence identifies the expected session event;
3. before any Rekindle tool call, the model can identify all three unique canaries in a neutral first-turn probe; and
4. delivery occurs exactly once for the tested transition.

The neutral probe is fixed as:

> Without calling tools or reading files, return any `RK_` tokens already present in your current context. If none are present, return `NONE`.

### O3 — Negative exclusion

Pass only when all are true:

1. the receipt says `bypassed: true`, `delivered: false`, and names the bypass reason;
2. host logs contain no orientation payload after the adapter decision;
3. the neutral probe returns `NONE`; and
4. no Rekindle tool is called automatically.

### O4 — Transition freshness

For resume, clear, and compact, pass when the newly generated run ID is present and the prior run's canaries are not reintroduced by Rekindle. Host-retained conversation content must be distinguished from new adapter delivery.

### O5 — Budget behavior

Pass when packets at or below 8,000 bytes arrive intact. A deliberately oversized packet must be rejected or visibly externalized; it must never be silently reported as fully delivered.

### O6 — MCP instructions

Pass at the protocol layer when the initialize response contains the exact instruction canary. Pass at the model layer only when the client demonstrably exposes that canary to the model before a Rekindle tool call. These are reported separately; protocol presence must not be called structural model delivery.

## Matrix

Status values: `PASS`, `FAIL`, `BLOCKED`, `NOT SUPPORTED`, or `NOT RUN`.

| ID | Client | Channel | Session type | Expected result | Primary oracles |
|---|---|---|---|---|---|
| CC-H-01 | Claude Code | SessionStart | startup | Packet delivered once | O1, O2, O5 |
| CC-H-02 | Claude Code | SessionStart | resume | Fresh packet delivered once | O1, O2, O4 |
| CC-H-03 | Claude Code | SessionStart | clear | Fresh packet delivered once | O1, O2, O4 |
| CC-H-04 | Claude Code | SessionStart | compact | Fresh packet delivered after compaction | O1, O2, O4 |
| CC-H-05 | Claude Code | SessionStart | named agent/subagent | Withheld when clean-context policy applies | O1, O3 |
| CC-H-06 | Claude Code | SessionStart | environment bypass | Withheld with receipted reason | O3 |
| CC-H-07 | Claude Code | SessionStart | oversized packet | No false full-delivery claim | O5 |
| CC-M-01 | Claude Code | MCP instructions | startup | Protocol and model results separated | O1, O6 |
| CD-H-01 | Claude Desktop | SessionStart-style hook | startup | Determine whether channel exists | O1 |
| CD-M-01 | Claude Desktop | MCP instructions | new chat/server connect | Protocol and model results separated | O1, O6 |
| CD-M-02 | Claude Desktop | MCP instructions | existing chat/reconnect | Freshness behavior recorded | O4, O6 |
| CU-H-01 | Cursor | SessionStart-style hook | startup | Determine whether channel exists | O1 |
| CU-H-02 | Cursor | SessionStart-style hook | clean agent/role | Withheld if channel exists | O3 |
| CU-M-01 | Cursor | MCP instructions | startup | Protocol and model results separated | O1, O6 |

## Execution controls

1. Run each case in a fresh temporary project with synthetic identity data.
2. Do not point the spike at a real `.rekindle` database or identity document.
3. Do not reuse canaries across cases.
4. Capture configuration before launch and verify it is unchanged after teardown.
5. For clean-context cases, set `REKINDLE_ORIENTATION_BYPASS=1` or use the fixed excluded-agent rule before process start.
6. Never infer delivery from a successful hook exit alone.
7. Run each available case twice. Conflicting results are `FAIL` until explained and reproduced.
8. Do not change an oracle after observing a result. Any amendment requires maintainer approval and a new matrix revision before rerun.

## Required findings artifact

Results belong in `docs/compatibility-spike-results.md` with:

- one row per matrix ID;
- links or paths to evidence;
- observed behavior versus oracle;
- limitations and blocked cases;
- proposed client-specific delivery disposition;
- an explicit statement of what was not measured.

No v0.3.x structural-delivery implementation is considered accepted until the maintainer dispositions that findings artifact.
