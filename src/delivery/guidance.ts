/**
 * Canonical workflow guidance — single source for BOTH delivery channels.
 *
 * CD-M-01 measured that Claude Desktop never shows the model the MCP
 * `instructions` field: the model sees only the tool listing (names +
 * descriptions). Any workflow guidance that lives solely in `instructions`
 * is invisible in Desktop. Gate 2's requirement: guidance must ride the
 * tool descriptions, and the two channels must not be able to drift.
 *
 * Structure, not convention: `composeInstructions()` and `withGuidance()`
 * are built from the same WORKFLOW_GUIDANCE fragments, and the test suite
 * asserts every fragment is visible through the real protocol tool listing
 * (the surface Desktop shows the model). Editing a fragment here updates
 * both channels; editing a description by hand without a fragment cannot
 * satisfy the tests.
 *
 * Fragments are also the measurement sentinels: the gate-2 Desktop probe
 * greps for these exact phrases in the model-visible context. Keep them
 * stable; a rewording is a measurement-invalidating change.
 */

/** Per-tool workflow fragments, appended to that tool's base description. */
export const WORKFLOW_GUIDANCE: Readonly<Record<string, string>> = {
  boot_report:
    "Workflow: call boot_report first thing every session, before any substantive work. " +
    "Orientation scores are structural checks, not guarantees that every relevant context item was loaded.",
  end_session:
    "Workflow: call end_session at the end of every substantive session so the next session can pick up the thread.",
  list_captures:
    "Workflow: if boot_report lists PreCompact captures, call list_captures then read_capture " +
    "to recover pre-compaction context before relying on the checkpoint. " +
    "Before calling end_session, check for unreviewed captures.",
  read_capture:
    "Workflow: read recovered captures before relying on the latest checkpoint; " +
    "start with the lightest mode that answers your question.",
};

const PREAMBLE =
  "Rekindle is a local continuity server: it preserves identity, memory, " +
  "checkpoints, and open loops across sessions.";

/**
 * The server `instructions` string, composed from the same fragments that
 * ride the tool descriptions. Clients that surface `instructions` get the
 * full workflow in one place; clients that do not (Claude Desktop) lose
 * nothing, because every sentence below also travels on a description.
 */
export function composeInstructions(): string {
  return [PREAMBLE, ...Object.values(WORKFLOW_GUIDANCE)].join(" ");
}

/**
 * Compose a tool's model-visible description: base behavior text plus the
 * tool's workflow fragment. Tools without a fragment keep their base text.
 */
export function withGuidance(toolName: string, baseDescription: string): string {
  const fragment = WORKFLOW_GUIDANCE[toolName];
  return fragment ? `${baseDescription} ${fragment}` : baseDescription;
}
