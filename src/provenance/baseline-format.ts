import { createHash } from "node:crypto";
import { FORMAT_VERSION, MERKLE_SPEC, jcs, merkleRoot, sortMerkleLeaves, type MerkleLeaf } from "./canonical.js";

// Baseline byte contract (plan phase 5, spec room 237 F/G as amended by 239 and 241).
// New definitions inside chain format version 1, added before any v1 baseline exists. canonical.ts is
// untouched. Any change to a tag, field list or rule here is a new format string, never an edit.

export const BASELINE_FORMAT = "rekindle-baseline-v1";
export const INVENTORY_FORMAT = "rekindle-inventory-v1";

export const MANIFEST_TAG = "rekindle-manifest-v1\x00";
export const INVENTORY_TAG = "rekindle-inventory-v1\x00";
export const INVENTORY_ROW_TAG = "rekindle-inventory-row-v1\x00";

export const MANIFEST_FORMAT =
  "SHA-256(MANIFEST_TAG || UTF-8 JCS([[kind, target_id, state_hash], ...])) in ordinal order, ordinal 0-based in MERKLE_SPEC order";

// The complete baseline meta_payload. Validation rejects any other key.
export const BASELINE_PAYLOAD_FIELDS = [
  "baseline_format",
  "algorithm",
  "leaf_format",
  "ordering",
  "leaf_count",
  "root",
  "manifest_hash",
  "manifest_format",
  "inventory_hash",
  "unverified_before",
] as const;

export interface BaselinePayload {
  baseline_format: typeof BASELINE_FORMAT;
  algorithm: string;
  leaf_format: string;
  ordering: string;
  leaf_count: number;
  root: string;
  manifest_hash: string;
  manifest_format: string;
  inventory_hash: string;
  unverified_before: true;
}

const HASH_HEX = /^[0-9a-f]{64}$/;

export function taggedSha256(tag: string, bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(tag, "utf8")).update(bytes).digest("hex");
}

// The leaves must already be in MERKLE_SPEC order: the manifest's ordinal order is the hashed order.
export function manifestBytes(leaves: readonly MerkleLeaf[]): Buffer {
  const sorted = sortMerkleLeaves(leaves);
  for (let i = 0; i < leaves.length; i++) {
    if (sorted[i].kind !== leaves[i].kind || sorted[i].target_id !== leaves[i].target_id) {
      throw new Error("manifest: leaves are not in MERKLE_SPEC order");
    }
  }
  return Buffer.from(jcs(leaves.map((leaf) => [leaf.kind, leaf.target_id, leaf.state_hash])), "utf8");
}

export function manifestHash(leaves: readonly MerkleLeaf[]): string {
  return taggedSha256(MANIFEST_TAG, manifestBytes(leaves));
}

export function buildBaselinePayload(leaves: readonly MerkleLeaf[], inventory_hash: string): string {
  if (!HASH_HEX.test(inventory_hash)) throw new Error("baseline payload: inventory_hash must be 64 lowercase hex characters");
  const payload: BaselinePayload = {
    baseline_format: BASELINE_FORMAT,
    algorithm: MERKLE_SPEC.algorithm,
    leaf_format: MERKLE_SPEC.leaf_format,
    ordering: MERKLE_SPEC.ordering,
    leaf_count: leaves.length,
    root: merkleRoot(leaves),
    manifest_hash: manifestHash(leaves),
    manifest_format: MANIFEST_FORMAT,
    inventory_hash,
    unverified_before: true,
  };
  return jcs(payload);
}

// Structural validation only; the signature and the manifest it names are checked by the caller.
export function parseBaselinePayload(text: string, format_version: number): BaselinePayload {
  if (format_version !== FORMAT_VERSION) throw new Error(`baseline payload: format_version must be ${FORMAT_VERSION}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("baseline payload: not JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("baseline payload: not an object");
  }
  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(BASELINE_PAYLOAD_FIELDS as readonly string[]).includes(key)) throw new Error(`baseline payload: unexpected field ${key}`);
  }
  for (const field of BASELINE_PAYLOAD_FIELDS) {
    if (!Object.hasOwn(record, field)) throw new Error(`baseline payload: missing field ${field}`);
  }
  if (jcs(record) !== text) throw new Error("baseline payload: stored text is not its JCS form");
  const expected: Record<string, unknown> = {
    baseline_format: BASELINE_FORMAT,
    algorithm: MERKLE_SPEC.algorithm,
    leaf_format: MERKLE_SPEC.leaf_format,
    ordering: MERKLE_SPEC.ordering,
    manifest_format: MANIFEST_FORMAT,
    unverified_before: true,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (record[field] !== value) throw new Error(`baseline payload: ${field} does not match this format`);
  }
  if (typeof record.leaf_count !== "number" || !Number.isSafeInteger(record.leaf_count) || record.leaf_count < 0) {
    throw new Error("baseline payload: leaf_count must be a non-negative safe integer");
  }
  for (const field of ["root", "manifest_hash", "inventory_hash"] as const) {
    if (typeof record[field] !== "string" || !HASH_HEX.test(record[field] as string)) {
      throw new Error(`baseline payload: ${field} must be 64 lowercase hex characters`);
    }
  }
  return record as unknown as BaselinePayload;
}
