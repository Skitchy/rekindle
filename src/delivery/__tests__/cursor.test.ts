import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseCursorHookInput, runCursorSessionStart } from "../cursor.js";
import { writeReceipt } from "../receipts.js";
import { HOOK_BUDGET_BYTES } from "../budget.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rekindle-cursor-test-"));
  mkdirSync(join(home, ".rekindle", "db"), { recursive: true });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const env = (extra: Record<string, string> = {}) => ({
  REKINDLE_BASE_DIR: home,
  ...extra,
});

/** Field-for-field the shape measured in CU-H-01 (runs-2026-08-06-clean). */
const measuredPayload = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    conversation_id: "0b345b6a-2542-411c-8ce8-8ac422b2f5eb",
    generation_id: "0b345b6a-2542-411c-8ce8-8ac422b2f5eb",
    model: "default",
    is_background_agent: false,
    session_id: "sess-cursor-1",
    hook_event_name: "sessionStart",
    cursor_version: "2026.08.04-aaa8809",
    workspace_roots: ["/Users/testuser/secret-project"],
    user_email: "sentinel-email@example.com",
    transcript_path: null,
    ...overrides,
  });

describe("parseCursorHookInput (whitelist)", () => {
  it("extracts only whitelisted fields", () => {
    const { input, isBackgroundAgent } = parseCursorHookInput(measuredPayload());
    expect(input).toEqual({
      session_id: "sess-cursor-1",
      source: "cursor-sessionStart",
      cwd: "/Users/testuser/secret-project",
    });
    expect(isBackgroundAgent).toBe(false);
  });

  it("the parsed record cannot smuggle the email anywhere", () => {
    const parsed = parseCursorHookInput(measuredPayload());
    expect(JSON.stringify(parsed)).not.toContain("sentinel-email");
  });

  it("tolerates malformed stdin without failing the session start", () => {
    const { input } = parseCursorHookInput("not json {{{");
    expect(input.session_id).toBeUndefined();
    expect(input.source).toBe("cursor-sessionStart");
  });
});

describe("runCursorSessionStart", () => {
  it("emits Cursor's measured response shape: top-level snake_case additional_context", () => {
    writeFileSync(join(home, ".rekindle", "identity.md"), "# Cursor test identity");
    const { stdout, receipt } = runCursorSessionStart(measuredPayload(), env());

    expect(stdout).not.toBeNull();
    const parsed = JSON.parse(stdout as string);
    expect(Object.keys(parsed)).toEqual(["additional_context"]);
    expect(parsed.additional_context).toContain("Cursor test identity");
    expect(parsed.hookSpecificOutput).toBeUndefined();

    expect(receipt.client).toBe("cursor");
    expect(receipt.emitted).toBe(true);
    expect(receipt.emitted_bytes).toBeLessThanOrEqual(HOOK_BUDGET_BYTES);
    expect(receipt.model_visible).toBe("unmeasured");
  });

  it("PRIVACY INVARIANT: neither email nor workspace path reaches the receipt, serialized or on disk", () => {
    writeFileSync(join(home, ".rekindle", "identity.md"), "# identity");
    const { receipt, receiptPath } = runCursorSessionStart(measuredPayload(), env());

    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain("sentinel-email");
    expect(serialized).not.toContain("@example.com");
    expect(serialized).not.toContain("secret-project");

    writeReceipt(receiptPath, receipt);
    const onDisk = readFileSync(receiptPath, "utf-8");
    expect(onDisk).not.toContain("sentinel-email");
    expect(onDisk).not.toContain("secret-project");
  });

  it("bypasses background agents by default with a truthful receipt", () => {
    writeFileSync(join(home, ".rekindle", "identity.md"), "# identity");
    const { stdout, receipt } = runCursorSessionStart(
      measuredPayload({ is_background_agent: true }),
      env()
    );
    expect(stdout).toBeNull();
    expect(receipt.bypassed).toBe(true);
    expect(receipt.bypass_reason).toContain("cursor-background-agent");
    expect(receipt.emitted).toBe(false);
  });

  it("REKINDLE_ORIENT_BACKGROUND_AGENTS=1 opts background agents in", () => {
    writeFileSync(join(home, ".rekindle", "identity.md"), "# identity");
    const { stdout, receipt } = runCursorSessionStart(
      measuredPayload({ is_background_agent: true }),
      env({ REKINDLE_ORIENT_BACKGROUND_AGENTS: "1" })
    );
    expect(stdout).not.toBeNull();
    expect(receipt.bypassed).toBe(false);
    expect(receipt.emitted).toBe(true);
  });

  it("honors the global orientation bypass with a truthful receipt", () => {
    const { stdout, receipt } = runCursorSessionStart(
      measuredPayload(),
      env({ REKINDLE_ORIENTATION_BYPASS: "1" })
    );
    expect(stdout).toBeNull();
    expect(receipt.bypassed).toBe(true);
    expect(receipt.bypass_reason).toBe("environment override");
  });

  it("keeps an oversized identity within budget in the Cursor shape", () => {
    writeFileSync(
      join(home, ".rekindle", "identity.md"),
      "水処理 cursor identity ".repeat(2000)
    );
    const { stdout } = runCursorSessionStart(measuredPayload(), env());
    const packet = JSON.parse(stdout as string).additional_context;
    expect(Buffer.byteLength(packet, "utf-8")).toBeLessThanOrEqual(HOOK_BUDGET_BYTES);
    expect(packet.includes("�")).toBe(false);
  });
});
