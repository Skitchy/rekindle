import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { MERKLE_SPEC, jcs, merkleRoot, type MerkleLeaf } from "../canonical.js";
import {
  BASELINE_FORMAT,
  BASELINE_PAYLOAD_FIELDS,
  MANIFEST_FORMAT,
  buildBaselinePayload,
  manifestBytes,
  manifestHash,
  parseBaselinePayload,
} from "../baseline-format.js";

interface VectorCase {
  name: string;
  leaves: MerkleLeaf[];
  expected: { manifest_bytes: string; manifest_hash: string; root: string; payload: string } | null;
}

const vectors = JSON.parse(readFileSync(new URL("./baseline-vectors.json", import.meta.url), "utf8")) as {
  inventory_hash: string;
  cases: VectorCase[];
};

// Independent recomputation from raw bytes, not through baseline-format.ts.
function rawManifestHash(leaves: MerkleLeaf[]): string {
  const body = JSON.stringify(leaves.map((l) => [l.kind, l.target_id, l.state_hash]));
  return createHash("sha256").update(Buffer.from("rekindle-manifest-v1\x00", "utf8")).update(Buffer.from(body, "utf8")).digest("hex");
}

// The provisional Phase 4 fixture convention (chained-write.test.ts at 1101e93): untagged.
function phase4ManifestHash(leaves: MerkleLeaf[]): string {
  return createHash("sha256").update(jcs(leaves.map((l) => [l.kind, l.target_id, l.state_hash]))).digest("hex");
}

describe("baseline format fixed vectors (spec 237 F, 241)", () => {
  it.each(vectors.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const computed = {
      manifest_bytes: manifestBytes(c.leaves).toString("utf8"),
      manifest_hash: manifestHash(c.leaves),
      root: merkleRoot(c.leaves),
      payload: buildBaselinePayload(c.leaves, vectors.inventory_hash),
    };
    if (c.expected === null) {
      console.log(`VECTOR ${c.name}: ${JSON.stringify(computed)}`);
      throw new Error(`vector ${c.name} has no pinned expected values`);
    }
    expect(computed).toEqual(c.expected);
    expect(computed.manifest_hash).toBe(rawManifestHash(c.leaves));
    expect(computed.manifest_bytes.endsWith("\n")).toBe(false);
    const parsed = parseBaselinePayload(computed.payload, 1);
    expect(parsed.leaf_count).toBe(c.leaves.length);
    expect(parsed.inventory_hash).toBe(vectors.inventory_hash);
  });

  it("reports every difference from the provisional Phase 4 convention", () => {
    for (const c of vectors.cases) {
      const differences: string[] = [];
      if (manifestHash(c.leaves) !== phase4ManifestHash(c.leaves)) differences.push("manifest_hash is now domain-tagged");
      const payload = JSON.parse(buildBaselinePayload(c.leaves, vectors.inventory_hash)) as Record<string, unknown>;
      const phase4Fields = ["algorithm", "leaf_format", "ordering", "leaf_count", "root", "manifest_hash", "unverified_before"];
      for (const field of Object.keys(payload)) if (!phase4Fields.includes(field)) differences.push(`new field ${field}`);
      console.log(`PHASE4 DIFF ${c.name}: ${differences.join("; ")}`);
      expect(differences).toEqual([
        "manifest_hash is now domain-tagged",
        "new field baseline_format",
        "new field inventory_hash",
        "new field manifest_format",
      ]);
      // The root is unchanged: Phase 4 already used canonical.ts's merkleRoot.
      expect(payload.root).toBe(merkleRoot(c.leaves));
    }
  });
});

describe("baseline payload validation", () => {
  const leaves: MerkleLeaf[] = [{ kind: "memory", target_id: "m1", state_hash: "a".repeat(64) }];
  const good = buildBaselinePayload(leaves, "1".repeat(64));
  const object = JSON.parse(good) as Record<string, unknown>;

  it("accepts the built payload and lists exactly the declared fields", () => {
    expect(Object.keys(parseBaselinePayload(good, 1)).sort()).toEqual([...BASELINE_PAYLOAD_FIELDS].sort());
    expect(object).toMatchObject({ baseline_format: BASELINE_FORMAT, manifest_format: MANIFEST_FORMAT, algorithm: MERKLE_SPEC.algorithm });
  });

  it.each([
    ["an unknown field", jcs({ ...object, extra: 1 })],
    ["a missing field", jcs(Object.fromEntries(Object.entries(object).filter(([k]) => k !== "root")))],
    ["non-JCS text", JSON.stringify(object, null, 1)],
    ["another baseline_format", jcs({ ...object, baseline_format: "rekindle-baseline-v2" })],
    ["another algorithm", jcs({ ...object, algorithm: "sha1" })],
    ["unverified_before = 1", jcs({ ...object, unverified_before: 1 })],
    ["a negative leaf_count", jcs({ ...object, leaf_count: -1 })],
    ["a fractional leaf_count", jcs({ ...object, leaf_count: 1.5 })],
    ["uppercase hex", jcs({ ...object, root: "A".repeat(64) })],
    ["a short inventory_hash", jcs({ ...object, inventory_hash: "1".repeat(63) })],
    ["not an object", "[]"],
    ["not JSON", "{"],
  ])("rejects %s", (_label, text) => {
    expect(() => parseBaselinePayload(text, 1)).toThrow(/baseline payload/);
  });

  it("rejects another chain format_version", () => {
    expect(() => parseBaselinePayload(good, 2)).toThrow(/format_version/);
  });

  it("refuses leaves out of MERKLE_SPEC order and a malformed inventory_hash", () => {
    const unordered: MerkleLeaf[] = [
      { kind: "session", target_id: "s1", state_hash: "c".repeat(64) },
      { kind: "memory", target_id: "m1", state_hash: "a".repeat(64) },
    ];
    expect(() => manifestBytes(unordered)).toThrow(/order/);
    expect(() => buildBaselinePayload(leaves, "xyz")).toThrow(/inventory_hash/);
  });
});
