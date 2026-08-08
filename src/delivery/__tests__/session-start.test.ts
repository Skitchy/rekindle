import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSessionStart } from "../session-start.js";
import { writeReceipt } from "../receipts.js";
import { HOOK_BUDGET_BYTES } from "../budget.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rekindle-ss-test-"));
  mkdirSync(join(home, ".rekindle", "db"), { recursive: true });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const env = (extra: Record<string, string> = {}) => ({
  REKINDLE_BASE_DIR: home,
  ...extra,
});

describe("runSessionStart", () => {
  it("delivers a budgeted packet with a truthful emission receipt", () => {
    writeFileSync(join(home, ".rekindle", "identity.md"), "# I am the test identity");
    const { stdout, receipt } = runSessionStart({ session_id: "s1" }, env());

    expect(stdout).not.toBeNull();
    const parsed = JSON.parse(stdout as string);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("test identity");

    expect(receipt.emitted).toBe(true);
    expect(receipt.emitted_bytes).toBe(
      Buffer.byteLength(parsed.hookSpecificOutput.additionalContext, "utf-8")
    );
    expect(receipt.emitted_bytes).toBeLessThanOrEqual(HOOK_BUDGET_BYTES);
    expect(receipt.model_visible).toBe("unmeasured");
    expect(receipt.bypassed).toBe(false);
    expect(receipt.error).toBeNull();
  });

  it("keeps an oversized identity within budget and records the truncation", () => {
    writeFileSync(
      join(home, ".rekindle", "identity.md"),
      "水処理 identity ".repeat(2000) // far over 8000 bytes
    );
    const { stdout, receipt } = runSessionStart({}, env());
    const packet = JSON.parse(stdout as string).hookSpecificOutput.additionalContext;

    expect(Buffer.byteLength(packet, "utf-8")).toBeLessThanOrEqual(HOOK_BUDGET_BYTES);
    expect(packet.includes("�")).toBe(false);
    const identity = receipt.sections.find((s) => s.name === "identity");
    expect(identity?.disposition).toBe("truncated");
    const dropped = receipt.sections.filter((s) => s.disposition !== "included");
    expect(dropped.length).toBeGreaterThan(0);
  });

  it("bypasses on environment override with a truthful receipt and no stdout", () => {
    const { stdout, receipt } = runSessionStart(
      { session_id: "s2" },
      env({ REKINDLE_ORIENTATION_BYPASS: "1" })
    );
    expect(stdout).toBeNull();
    expect(receipt.emitted).toBe(false);
    expect(receipt.emitted_bytes).toBe(0);
    expect(receipt.bypassed).toBe(true);
    expect(receipt.bypass_reason).toBe("environment override");
  });

  it("bypasses excluded agent types by name", () => {
    const { stdout, receipt } = runSessionStart(
      { agent_type: "clean-room" },
      env({ REKINDLE_ORIENTATION_EXCLUDE_AGENTS: "clean-room, other" })
    );
    expect(stdout).toBeNull();
    expect(receipt.bypass_reason).toBe("excluded agent type: clean-room");
  });

  it("reports storage failure in the receipt instead of claiming delivery", () => {
    const { stdout, receipt } = runSessionStart(
      {},
      { REKINDLE_DB_PATH: "/dev/null/impossible/memories.db" }
    );
    expect(stdout).toBeNull();
    expect(receipt.emitted).toBe(false);
    expect(receipt.error).not.toBeNull();
    expect(receipt.bypassed).toBe(false);
  });

  it("writes receipts as appendable JSONL", () => {
    const path = join(home, "receipts.jsonl");
    const { receipt } = runSessionStart({}, env());
    writeReceipt(path, receipt);
    writeReceipt(path, receipt);
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(() => JSON.parse(lines[1])).not.toThrow();
  });
});
