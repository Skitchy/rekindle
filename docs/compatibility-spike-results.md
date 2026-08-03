# Structural Delivery Compatibility Spike — Results

Date: 2026-08-03
Matrix: [compatibility-spike-matrix.md](./compatibility-spike-matrix.md)
Status: **Initial host/protocol pass; model and cross-client cases remain gated**

The maintainer ratified the matrix before these cases ran. The baseline MCP measurement exposed one narrow protocol gap; the stabilization branch added only the server `instructions` field and reran that oracle. No structural SessionStart implementation was changed as a result of the measurements.

## Environment

| Item | Value |
|---|---|
| OS | macOS; local Codex sandbox with isolated temporary test project |
| Rekindle checkout | `codex/v0.3.1-stabilization` |
| Claude Code | 2.1.220 |
| Claude Desktop | 1.24012.9 |
| Cursor | Not installed |
| Test project | `/private/tmp/rekindle-claude-spike/project` |
| State isolation | `HOME` and `CLAUDE_CONFIG_DIR` redirected to `/private/tmp/rekindle-claude-spike/` |

The first model-level attempt without isolated state failed before reaching the oracle because Claude Code tried to write `/Users/skitch/.claude.json` and `/Users/skitch/.claude/todos`. That run was stopped. No real user settings were changed.

## Results

| Matrix ID | Result | Evidence and disposition |
|---|---|---|
| CC-H-01 | **PASS (host-level)** | `claude --init-only` matched `SessionStart: startup`, executed the probe, and parsed JSON `hookSpecificOutput` containing all three fresh canaries. Receipt: run `CC-H-01-ISOLATED`; debug log recorded matcher resolution and parsed output. Model-level O2 remains blocked by authentication. |
| CC-H-02 | **BLOCKED** | Resume requires an authenticated session/model run; no safe session fixture exists in the isolated state. |
| CC-H-03 | **BLOCKED** | Clear requires an authenticated interactive/session run. |
| CC-H-04 | **BLOCKED** | Compact requires an authenticated session and a controlled compaction transition. |
| CC-H-05 | **BLOCKED** | `--init-only --agent clean-extractor` did not pass `agent_type` into the hook input, so the negative subagent oracle cannot be claimed from this host-only path. The standalone probe's excluded-agent logic passed with synthetic input. |
| CC-H-06 | **PASS (host-level)** | `REKINDLE_ORIENTATION_BYPASS=1` produced a receipt with `delivered:false`, `bypassed:true`, reason `environment override`, and no orientation payload. |
| CC-H-07 | **NOT RUN** | Packet budget boundary requires a model-level run or host behavior that exposes oversized-output externalization. |
| CC-M-01 | **PASS (protocol-level after fix)** | The pre-fix initialize response omitted `instructions`, confirming the implementation gap. After adding concise server instructions, a fresh initialize response returned the exact guidance string. Client/model exposure remains unmeasured. |
| CD-H-01 | **BLOCKED** | Claude Desktop is installed, but its `claude_desktop_config.json` currently has `mcpServers:{}` and no hook configuration. No client mutation was made. |
| CD-M-01 | **BLOCKED** | Rekindle is not configured in Claude Desktop, so no client-level MCP-instructions observation is possible yet. |
| CD-M-02 | **BLOCKED** | Same configuration prerequisite as CD-M-01. |
| CU-H-01 | **BLOCKED** | Cursor is not installed. |
| CU-H-02 | **BLOCKED** | Cursor is not installed. |
| CU-M-01 | **BLOCKED** | Cursor is not installed. |

## Confirmed findings

1. Claude Code's current SessionStart configuration accepts the documented matcher set and executes a command hook on startup.
2. JSON `hookSpecificOutput` with `hookEventName: "SessionStart"` and `additionalContext` is accepted and parsed by Claude Code 2.1.220.
3. A bypass can suppress the packet while producing an auditable receipt. This is a host-level result; the model-level absence oracle still needs authentication.
4. The Rekindle server initially omitted MCP `instructions`; the stabilization branch now advertises concise guidance during initialization. Client-level exposure must still be measured separately.
5. The compatibility harness must run with isolated Claude state in automated environments. Otherwise the host attempts writes outside the test project and can create watcher/resource failures.

## What remains unmeasured

- Whether the three canaries reach model context before the first prompt in an authenticated Claude Code session.
- Resume, clear, and post-compaction delivery and exactly-once behavior.
- Subagent/role metadata and negative exclusion in a real host session.
- Claude Desktop's handling of MCP instructions.
- Cursor's hook and MCP behavior.
- Oversized-packet externalization and receipt truthfulness.

## Provisional acceptance criteria for implementation

These criteria are derived only from the confirmed results and remain subject to maintainer disposition alongside the blocked cases:

- `SessionStart` delivery is opt-in, budget-aware, and source-aware for startup, resume, clear, and compact.
- A bypass contract exists for clean-context sessions and records a reason without emitting orientation content.
- The MCP server publishes concise `instructions`, with no claim that protocol presence equals model-context delivery.
- Every delivery attempt produces a receipt with channel, source, run ID, byte count, delivered/bypassed state, and reason.
- Automated package tests run with isolated Claude state and fail if the host writes outside the test project.
- Positive and negative client cases are both required before structural delivery is called complete.

## Gate

The next implementation gate is not “make the hook work”—that host-level fact is already established. It is to obtain authenticated Claude Code model evidence and client access for Desktop/Cursor, then disposition the blocked cases. No structural-delivery acceptance claim should be made from the current partial matrix.
