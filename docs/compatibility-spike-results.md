# Structural Delivery Compatibility Spike — Results

Date: 2026-08-03
Matrix: [compatibility-spike-matrix.md](./compatibility-spike-matrix.md)
Status: **Three passes recorded. Pass 1: sandbox host/protocol measurements (below). Pass 2: authenticated Claude Code model-level measurements, 2026-08-03. Pass 3: Claude Desktop measurements, 2026-08-03. Cursor remains evidence-pending (maintainer chose the Cursor CLI installer as the measurement surface).**

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

---

# Pass 2: Claude Code model-level measurements (2026-08-03, maintainer machine)

Maintainer authorization for this ledger update was given on the direct maintainer channel, 2026-08-03 09:32 UTC, and is recorded here per channel convention. This pass upgrades the Claude Code column only; it makes no claim about Desktop or Cursor. Adversarial verification by Ari (discussion 4) and the subsequent correction round are incorporated; the two evidence defects Ari caught (a false "every case ran twice" aggregate claim, and truncation language asserting a mechanism the artifacts did not show) are corrected below, not papered over.

## Environment

| Item | Value |
|---|---|
| Client | Claude Code 2.1.220, macOS 26.5.2 (arm64), authenticated user state |
| Checkout measured | `codex/v0.3.1-stabilization` at `910fc08eb85f8b1d405c16a62b3436824cc8be70`; 102/102 tests, build, `verify:package`, and audit re-run on this machine before any case executed |
| Probe harness | `scripts/compatibility-spike/session-start-probe.mjs` from the branch, unmodified; one variant harness (`oversized-probe.mjs`, hashed in the manifest) for CC-H-07 only, identical receipt logic with a 15,065-byte packet |
| Probe model | claude-haiku-4-5-20251001 |
| Isolation | Fresh temp project per case, synthetic run-scoped canaries, `--setting-sources project` plus the operator's identity-hook environment bypass. A leak-control session ran first and returned no operator identity-anchor content. |

## Evidence binding

Every artifact for these runs is bound by SHA-256 in [`compatibility-spike-evidence-manifest.json`](./compatibility-spike-evidence-manifest.json) (schema `spike-evidence-manifest/v1`: 27 artifacts, measured commit pinned). Committed manifest digest: `2f032114ba71355b5b02d0e691cdb0306b8091fff98a40b2df80880a9d7ce6a9`. The artifact hashes are the evidentiary reference; workstation paths carry no evidentiary weight.

## Limitation on these runs

The matrix-required pre/post host-configuration comparison (execution control 4) was **not captured** for the completed Claude Code runs; final configurations only were preserved. This is stated as a limitation of these results, not retrofitted. The runner gains capture-before-launch and verify-after-teardown before any further measurement block executes.

## Results (model level, one row per matrix ID)

| Matrix ID | Result | Observed behavior vs oracle, manifest-bound evidence |
|---|---|---|
| CC-H-01 | **PASS** | Both attempts: receipt `delivered:true`, `session_source` startup; neutral first-turn probe returned all three run-scoped canaries verbatim before any tool call; exactly one receipt per session (O1, O2, O5 for in-budget packet). Evidence: `CC-H-01/attempt{1,2}/receipts.jsonl`, `session-output.json`. |
| CC-H-02 | **PASS** | Attempt 1 verified independently by Ari; attempt 2 is the correction-round rerun with client version present in both receipts (harness gap fixed before rerun). Hook re-fired on `claude --resume` with `session_source` resume, one emission per transition, resumed probe returned only the new run's canaries; prior canaries persisted solely as host conversation history, distinguishable via the receipt trail (O4). The original packet's claim that every executed case ran twice was false for this case; corrected on the public record. Evidence: `CC-H-02/attempt{1,2}/*`. |
| CC-H-03 | **BLOCKED** | No controlled clear transition drivable in print mode; needs an interactive fixture (piggyback proposal stands). |
| CC-H-04 | **BLOCKED** | Compaction not deterministically forceable in print mode; same interactive-fixture path. |
| CC-H-05 | **BLOCKED (gap confirmed)** | No `agent_type` reaches SessionStart hook input on drivable paths, consistent with the Pass 1 sandbox observation. Exclusion logic itself is proven by CC-H-06; scoping by agent identity remains unproven. SubagentStart is the likelier correct channel and enters the implementation design as its own measured question. |
| CC-H-06 | **PASS** | Both attempts, both directions: receipt `bypassed:true` with reason `environment override`, probe returned `NONE`, no orientation payload anywhere in host output (O3). Evidence: `CC-H-06/attempt{1,2}/*`. |
| CC-H-07 | **FAIL for naive delivery (O5); mechanism: externalization plus model-invisibility** | The host **externalizes** over-limit hook output to session storage (`tool-results/hook-<id>-1-additionalContext.txt`, complete 15,065-byte packet preserved including the trailing canary, hashed in the manifest) and passes only a leading portion into model context. No stderr signal; no pointer the model surfaced in the probe. The naive receipt claimed full delivery of bytes the model never saw. Reproduced on both attempts. Consequences: the adapter must enforce its own budget before emission, and the receipt must record the enforced budget rather than echoing intended bytes. Evidence: `CC-H-07/attempt{1,2}/*` including both `externalized-additionalContext.txt` artifacts. |
| CC-M-01 | **PASS (model level)** | Both attempts: with the branch build connected as an MCP server, the model quoted the server instructions string verbatim in a neutral no-tools first turn (O6 model layer). Upgrades the Pass 1 protocol-level result. Evidence: `CC-M-01/attempt{1,2}/session-output.json`, `rekindle-dist-index.js` hash. |

## Receipt vocabulary

Per the stable acceptance criteria from adversarial verification, receipts must keep these states distinct and never conflate them: **attempted**, **emitted**, **externalized**, **withheld**, and **model-visible**. A delivery claim requires model-visible evidence or a budget enforced before emission; emitted alone is never "delivered."

## Source-aware support table

| Source / client surface | State |
|---|---|
| Claude Code startup | Closed: measured PASS |
| Claude Code resume | Closed: measured PASS (as of the correction round) |
| Claude Code clear | Open: interactive fixture required |
| Claude Code compact | Open: interactive fixture required |
| Claude Code subagent scope | Open: SubagentStart measurement |
| Claude Desktop | Evidence-pending |
| Cursor | Evidence-pending (not installed at time of writing) |

## What was not measured in Pass 2

- Clear and post-compaction delivery and exactly-once behavior (CC-H-03/04).
- Subagent/role scoping in a real host session (CC-H-05).
- Claude Desktop and Cursor, all cases.
- Pre/post host-configuration integrity for the completed runs (stated above as a limitation).

No structural-delivery acceptance claim is made beyond the measured rows. Disposition of this findings artifact remains with the maintainer per the matrix gate.

---

# Pass 3: Claude Desktop measurements (2026-08-03, maintainer machine)

Maintainer authorization for the Desktop block was given on the direct maintainer channel (2026-08-03 09:32 UTC, reconfirmed ~10:05 UTC). The close-out decision to skip the CD-M-02 model-level probe was the maintainer's, ~10:57 UTC; rationale recorded in that row.

## Environment

| Item | Value |
|---|---|
| Client | Claude Desktop 1.24012.9, macOS (arm64) |
| Chat model | Fable 5 (High) via the app's chat surface; delivery mechanics measured here are client behavior, not model behavior |
| Rekindle build | `dist/index.js` rebuilt from `codex/v0.3.1-stabilization`; SHA-256 identical to the Pass 2 manifest artifact (`3ab52fec...`), so all passes measured the same build |
| Evidence form | Screenshots, client MCP logs, config snapshots, receipt-file absence. Weaker by nature than the machine-readable Claude Code column; stated here per the source-aware discipline |

## Execution control 4: implemented for this block

The gap stated as a limitation on Pass 2 was closed before any Desktop case ran: the runner (`desktop-cases.sh`, hashed in the manifest) captured and SHA-256-hashed the live `claude_desktop_config.json` before any mutation, every mutation was a jq merge preserving all user preferences, and teardown restored the original config **verified byte-identical** against the pre-run hash (`3aae3a33...`, restore log in `CD-capture-log.txt`).

## Results (one row per matrix ID)

| Matrix ID | Result | Observed behavior vs oracle, manifest-bound evidence |
|---|---|---|
| CD-H-01 | **NOT SUPPORTED** | A Claude-Code-style `hooks.SessionStart` block in `claude_desktop_config.json` is silently ignored (O1: never invoked). Two attempts, each a full app launch plus a completed chat session: no probe execution, no receipt file, no validation error, app fully functional. Evidence: `desktop/CD-H-01/attempt{1,2}/*`. |
| CD-M-01 | **Two findings** | **(a) FAIL to attach as shipped:** Claude Desktop spawns MCP servers with working directory `/`; rekindle 0.3.0 resolves its SQLite path from cwd at module load, so it crashes (`ENOENT: mkdir '/.rekindle/db'`) before completing initialization. The client surfaces "Could not attach to MCP server rekindle." Rekindle 0.3.0 is unusable in Claude Desktop without a wrapper. Evidence: `desktop/CD-M-01/mcp-log-as-shipped-attach-failure.log`, toast screenshot. **(b) With a documented cwd-wrapper deviation** (`bash -c "cd <spike project> && exec node dist/index.js"`, config in manifest): protocol layer PASS (initialize completes; the same build demonstrably emits the `instructions` field, verified by direct stdio initialize), model layer **FAIL** (O6): in two fresh chats the model reported and quoted verbatim that the only rekindle content in its context is a deferred tool listing (10 tool names with one-line descriptions) surfaced via the client's tool_search mechanism; no instructions text, reproduced twice. Evidence: `desktop/CD-M-01/attempt{1,2}-reply-screenshot.png`. |
| CD-M-02 | **PARTIAL: protocol level only** | Server reconnects cleanly after app restart (fresh spawn, complete re-handshake, tools re-listed; `desktop/CD-M-02/mcp-log-reconnect.log`). Model-level freshness in an existing chat was **NOT RUN** by maintainer decision at close-out: CD-M-01 had already proven the instructions channel never reaches the model on this client, so the probe would have measured the freshness of a non-delivering channel. |

## Consequences for v0.3.1

1. **Storage must not derive from cwd.** Desktop launches servers at `/`. The storage root needs an explicit resolution order (env var, then home-directory default), and module load must not require a writable database; instructions/handshake must succeed storage-less.
2. **The MCP instructions field is a Claude-Code-only model channel** among clients measured so far. On Claude Desktop, the only guidance that reaches the model is tool names and short descriptions, so Desktop orientation guidance must ride in tool descriptions (the `boot_report` description is the natural carrier).
3. The layered delivery contract is confirmed by measurement: no single channel exists across both clients.

## Source-aware support table (updated)

| Source / client surface | State |
|---|---|
| Claude Code startup / resume | Closed: measured PASS (Pass 2) |
| Claude Code clear / compact / subagent scope | Open (Pass 2 rows unchanged) |
| Claude Desktop hook channel | Closed: NOT SUPPORTED |
| Claude Desktop MCP instructions | Closed: protocol-only; model delivery absent |
| Claude Desktop tool descriptions | Observed present in model context (candidate carrier, not yet a measured delivery contract) |
| Cursor (CLI surface, per maintainer ruling) | Evidence-pending: awaiting install |

## Evidence binding

The committed manifest now binds 40 artifacts (27 from Pass 2 plus 13 Desktop artifacts under `desktop/`). Extended manifest digest: `ddb6e9d59f66f47a012d8dfb35924ff4fb915abe6fae0022a966a28da8e70bab`. The Pass 2 section's digest citation reflects the manifest as first committed and remains historically accurate.

No structural-delivery acceptance claim is made from this pass. Disposition remains with the maintainer per the matrix gate.
