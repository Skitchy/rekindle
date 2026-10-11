import { createHash } from "node:crypto";
import canonicalize from "canonicalize";

// Provenance byte contract, format version 1.
// Design: docs/provenance-chain-design.md (sections 1, 2, 3, 5, 7).
// Any change to a tag, field list, encoding or Merkle rule is a new format version, never an edit here.

export const FORMAT_VERSION = 1;

export const CHAIN_TAG = "rekindle-chain-v1\x00";
export const ROTATE_TAG = "rekindle-rotate-v1\x00";
export const MERKLE_TAG = "rekindle-merkle-v1\x00";
export const STATE_TAGS = {
  memory: "rekindle-state-memory-v1\x00",
  session: "rekindle-state-session-v1\x00",
} as const;

export type StateKind = keyof typeof STATE_TAGS;
export type CanonicalScalar = string | number | null;

export const NONCE_BYTES = 32;

// Design section 3: every memory column except the operational retrieval_count and last_accessed.
// id is bound as target_id in the chain entry and Merkle leaf; nonce is bound separately in stateHash.
export const MEMORY_STATE_FIELDS = [
  "content",
  "category",
  "importance",
  "project",
  "type",
  "source",
  "session_id",
  "created_at",
  "updated_at",
  "writer_client",
  "writer_thread_id",
  "request_id",
  "author_identity",
  "authorization_reference",
  "authorization_verified",
] as const;
const MEMORY_STATE_EXCLUDED = ["id", "retrieval_count", "last_accessed", "nonce"] as const;

export const SESSION_STATE_FIELDS = [
  "summary",
  "project",
  "started_at",
  "ended_at",
  "checkpoint_memory_id",
  "gap_count",
  "orientation_score",
  "transcript_path",
] as const;
const SESSION_STATE_EXCLUDED = ["id", "nonce"] as const;

// Design section 1: the chain row plus the event's provenance fields (the audit row's columns).
// signature is excluded from entry_hash for every entry; entry_hash cannot cover itself.
export const ENTRY_FIELDS = [
  "seq",
  "store_id",
  "format_version",
  "audit_kind",
  "audit_id",
  "target_id",
  "action",
  "state_hash",
  "prior_state_hash",
  "meta_payload",
  "prev_hash",
  "key_id",
  "created_at",
  "client",
  "thread_id",
  "request_id",
  "author_identity",
  "authorization_reference",
  "authorization_verified",
] as const;
const ENTRY_EXCLUDED = ["signature", "entry_hash"] as const;

// Design section 7: the statement both keys sign. Only the two inner signatures are absent.
export const ROTATION_STATEMENT_FIELDS = [
  "seq",
  "store_id",
  "format_version",
  "prev_hash",
  "event_at",
  "old_key_id",
  "new_key_id",
  "new_public_key",
] as const;
const ROTATION_STATEMENT_EXCLUDED = ["old_signature", "new_signature"] as const;

// Design section 7: the complete rotation meta_payload, inner signatures included.
export const ROTATION_PAYLOAD_FIELDS = [
  "old_key_id",
  "new_key_id",
  "new_public_key",
  "old_signature",
  "new_signature",
] as const;

// Merkle construction for the baseline root (design section 5). The baseline entry binds this description.
export const MERKLE_SPEC = {
  algorithm: "rfc6962-mth-sha256-tagged-v1",
  leaf_format: "JCS([kind, target_id, state_hash])",
  ordering: "ascending by UTF-8 bytes of kind, then by UTF-8 bytes of target_id; duplicate (kind, target_id) rejected",
  leaf_hash: "SHA-256(MERKLE_TAG || 0x00 || leaf_bytes)",
  node_hash: "SHA-256(MERKLE_TAG || 0x01 || left || right)",
  empty_root: "SHA-256(MERKLE_TAG || 0x02)",
  split: "RFC 6962 section 2.1: left subtree holds the largest power of two strictly less than n leaves",
} as const;

export interface MerkleLeaf {
  kind: StateKind;
  target_id: string;
  state_hash: string;
}

type Row = Record<string, unknown>;

function checkScalar(label: string, field: string, value: unknown): CanonicalScalar {
  if (value === null || typeof value === "string") return value;
  // Integers only: floats are where JCS number formatting is hardest to reproduce, and no v1 column is REAL.
  // Booleans are rejected so that true and 1 can never hash as two different states of the same column.
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new Error(`${label}: field ${field} must be a string, null or a safe integer`);
}

function pickFields(
  label: string,
  row: Row,
  fields: readonly string[],
  excluded: readonly string[],
): Record<string, CanonicalScalar> {
  for (const key of Object.keys(row)) {
    if (!fields.includes(key) && !excluded.includes(key)) {
      throw new Error(`${label}: unexpected field ${key}`);
    }
  }
  const picked: Record<string, CanonicalScalar> = {};
  for (const field of fields) {
    if (!Object.hasOwn(row, field) || row[field] === undefined) {
      throw new Error(`${label}: missing field ${field}`);
    }
    picked[field] = checkScalar(label, field, row[field]);
  }
  return picked;
}

export function jcs(value: unknown): string {
  const text = canonicalize(value);
  if (text === undefined) throw new Error("value has no JSON representation");
  return text;
}

function taggedDigest(tag: string, ...parts: Uint8Array[]): Buffer {
  const hash = createHash("sha256").update(Buffer.from(tag, "utf8"));
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function jcsBytes(value: unknown): Buffer {
  return Buffer.from(jcs(value), "utf8");
}

export function stateHash(kind: StateKind, nonce: Uint8Array, row: Row): string {
  if (!(nonce instanceof Uint8Array) || nonce.length !== NONCE_BYTES) {
    throw new Error(`state ${kind}: nonce must be ${NONCE_BYTES} bytes`);
  }
  const fields =
    kind === "memory"
      ? pickFields("memory state", row, MEMORY_STATE_FIELDS, MEMORY_STATE_EXCLUDED)
      : kind === "session"
        ? pickFields("session state", row, SESSION_STATE_FIELDS, SESSION_STATE_EXCLUDED)
        : null;
  if (fields === null) throw new Error(`unknown state kind ${String(kind)}`);
  return taggedDigest(STATE_TAGS[kind], nonce, jcsBytes(fields)).toString("hex");
}

export function entryHash(entry: Row): string {
  const fields = pickFields("chain entry", entry, ENTRY_FIELDS, ENTRY_EXCLUDED);
  return taggedDigest(CHAIN_TAG, jcsBytes(fields)).toString("hex");
}

export function rotationStatementHash(statement: Row): string {
  const fields = pickFields("rotation statement", statement, ROTATION_STATEMENT_FIELDS, ROTATION_STATEMENT_EXCLUDED);
  return taggedDigest(ROTATE_TAG, jcsBytes(fields)).toString("hex");
}

// The stored meta_payload text for a key_rotate entry; entryHash binds it as stored.
export function rotationMetaPayload(payload: Row): string {
  return jcs(pickFields("rotation payload", payload, ROTATION_PAYLOAD_FIELDS, []));
}

const HASH_HEX = /^[0-9a-f]{64}$/;

function compareLeaves(a: MerkleLeaf, b: MerkleLeaf): number {
  return (
    Buffer.compare(Buffer.from(a.kind, "utf8"), Buffer.from(b.kind, "utf8")) ||
    Buffer.compare(Buffer.from(a.target_id, "utf8"), Buffer.from(b.target_id, "utf8"))
  );
}

export function sortMerkleLeaves(leaves: readonly MerkleLeaf[]): MerkleLeaf[] {
  for (const leaf of leaves) {
    if (!Object.hasOwn(STATE_TAGS, leaf.kind)) throw new Error(`merkle leaf: unknown kind ${String(leaf.kind)}`);
    if (typeof leaf.target_id !== "string" || leaf.target_id.length === 0) {
      throw new Error("merkle leaf: target_id must be a non-empty string");
    }
    if (typeof leaf.state_hash !== "string" || !HASH_HEX.test(leaf.state_hash)) {
      throw new Error("merkle leaf: state_hash must be 64 lowercase hex characters");
    }
  }
  const sorted = [...leaves].sort(compareLeaves);
  for (let i = 1; i < sorted.length; i++) {
    if (compareLeaves(sorted[i - 1], sorted[i]) === 0) {
      throw new Error(`merkle leaf: duplicate ${sorted[i].kind} ${sorted[i].target_id}`);
    }
  }
  return sorted;
}

function merkleTreeHash(leafHashes: Buffer[]): Buffer {
  if (leafHashes.length === 1) return leafHashes[0];
  let split = 1;
  while (split * 2 < leafHashes.length) split *= 2;
  return taggedDigest(
    MERKLE_TAG,
    Buffer.from([0x01]),
    merkleTreeHash(leafHashes.slice(0, split)),
    merkleTreeHash(leafHashes.slice(split)),
  );
}

export function merkleRoot(leaves: readonly MerkleLeaf[]): string {
  const sorted = sortMerkleLeaves(leaves);
  if (sorted.length === 0) return taggedDigest(MERKLE_TAG, Buffer.from([0x02])).toString("hex");
  const leafHashes = sorted.map((leaf) =>
    taggedDigest(MERKLE_TAG, Buffer.from([0x00]), jcsBytes([leaf.kind, leaf.target_id, leaf.state_hash])),
  );
  return merkleTreeHash(leafHashes).toString("hex");
}
