import { describe, it, expect } from "vitest";
import {
  budgetPacket,
  truncateUtf8,
  HOOK_BUDGET_BYTES,
} from "../budget.js";

const bytes = (s: string) => Buffer.byteLength(s, "utf-8");

describe("truncateUtf8", () => {
  it("returns short strings unchanged", () => {
    expect(truncateUtf8("hello", 100)).toBe("hello");
  });

  it("never splits a multi-byte code point", () => {
    const s = "水処理は楽しい"; // 3 bytes per char
    for (let max = 0; max <= bytes(s); max++) {
      const out = truncateUtf8(s, max);
      expect(bytes(out)).toBeLessThanOrEqual(max);
      // Round-trip must not produce a replacement character
      expect(out.includes("�")).toBe(false);
      expect(s.startsWith(out)).toBe(true);
    }
  });

  it("handles 4-byte emoji at every cut position", () => {
    const s = "🚰🚰🚰🚰";
    for (let max = 0; max <= bytes(s); max++) {
      const out = truncateUtf8(s, max);
      expect(bytes(out)).toBeLessThanOrEqual(max);
      expect(out.includes("�")).toBe(false);
    }
  });
});

describe("budgetPacket", () => {
  it("passes small packets through untouched", () => {
    const p = budgetPacket([
      { name: "a", content: "one" },
      { name: "b", content: "two" },
    ]);
    expect(p.text).toBe("one\n\ntwo");
    expect(p.sections.every((s) => s.disposition === "included")).toBe(true);
    expect(p.budget_bytes).toBe(HOOK_BUDGET_BYTES);
  });

  it("truncates an oversized section with an explicit marker", () => {
    const p = budgetPacket(
      [{ name: "big", content: "x".repeat(10_000) }],
      1000
    );
    expect(p.bytes).toBeLessThanOrEqual(1000);
    expect(p.sections[0].disposition).toBe("truncated");
    expect(p.text).toContain("truncated to fit");
    expect(p.sections[0].full_bytes).toBe(10_000);
    expect(p.sections[0].emitted_bytes).toBe(bytes(p.text));
  });

  it("drops a section when the leftover room is too small to be useful, but still fits later smaller sections", () => {
    const p = budgetPacket(
      [
        { name: "first", content: "a".repeat(950) },
        { name: "huge", content: "b".repeat(5000) },
        { name: "tiny", content: "c".repeat(10) },
      ],
      1000
    );
    expect(p.sections.find((s) => s.name === "first")?.disposition).toBe("included");
    expect(p.sections.find((s) => s.name === "huge")?.disposition).toBe("dropped");
    expect(p.sections.find((s) => s.name === "tiny")?.disposition).toBe("included");
    expect(p.bytes).toBeLessThanOrEqual(1000);
  });

  it("never exceeds the budget across adversarial multi-byte sizes", () => {
    const contents = ["水".repeat(700), "🚰".repeat(600), "mixed 水🚰 ascii ".repeat(200)];
    for (let budget = 100; budget <= 4000; budget += 137) {
      const p = budgetPacket(
        contents.map((content, i) => ({ name: `s${i}`, content })),
        budget
      );
      expect(p.bytes).toBeLessThanOrEqual(budget);
      expect(p.text.includes("�")).toBe(false);
    }
  });

  it("respects priority order: later sections give way first", () => {
    const p = budgetPacket(
      [
        { name: "identity", content: "i".repeat(600) },
        { name: "transcript", content: "t".repeat(600) },
      ],
      700
    );
    expect(p.sections.find((s) => s.name === "identity")?.disposition).toBe("included");
    expect(p.sections.find((s) => s.name === "transcript")?.disposition).not.toBe("included");
  });
});
