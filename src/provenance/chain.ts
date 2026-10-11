import { sign, type KeyObject } from "node:crypto";
import { FORMAT_VERSION, entryHash } from "./canonical.js";

// Chain entry assembly for semantic write events (plan phase 4). Pure: the caller supplies every
// field, including the current head; all reads happen in storage under the write lock.

export interface ChainHead {
  seq: number;
  entry_hash: string;
}

// The audit row's provenance columns, as stored. entry_hash binds them (Phase 1 interpretation a).
export interface AuditProvenance {
  client: string | null;
  thread_id: string | null;
  request_id: string | null;
  author_identity: string | null;
  authorization_reference: string | null;
  authorization_verified: number;
}

export interface ChainEvent {
  head: ChainHead;
  store_id: string;
  key: KeyObject;
  key_id: string;
  audit_kind: "memory" | "session";
  audit_id: string;
  target_id: string;
  action: "store" | "update" | "delete" | "create";
  state_hash: string | null;
  prior_state_hash: string | null;
  created_at: string;
  provenance: AuditProvenance;
}

export interface ChainRow {
  seq: number;
  store_id: string;
  format_version: number;
  audit_kind: string;
  audit_id: string;
  target_id: string;
  action: string;
  state_hash: string | null;
  prior_state_hash: string | null;
  meta_payload: null;
  prev_hash: string;
  entry_hash: string;
  key_id: string;
  signature: string;
  created_at: string;
}

const HASH_HEX = /^[0-9a-f]{64}$/;

// Ed25519 over the 32 raw digest bytes decoded from entry_hash, not its 64 ASCII characters.
export function signEntryHash(entry_hash: string, key: KeyObject): string {
  if (!HASH_HEX.test(entry_hash)) throw new Error("entry_hash must be 64 lowercase hex characters");
  return sign(null, Buffer.from(entry_hash, "hex"), key).toString("hex");
}

export function buildChainRow(event: ChainEvent): ChainRow {
  const fields = {
    seq: event.head.seq + 1,
    store_id: event.store_id,
    format_version: FORMAT_VERSION,
    audit_kind: event.audit_kind,
    audit_id: event.audit_id,
    target_id: event.target_id,
    action: event.action,
    state_hash: event.state_hash,
    prior_state_hash: event.prior_state_hash,
    meta_payload: null,
    prev_hash: event.head.entry_hash,
    key_id: event.key_id,
    created_at: event.created_at,
    ...event.provenance,
  };
  const entry_hash = entryHash(fields);
  return {
    seq: fields.seq,
    store_id: fields.store_id,
    format_version: fields.format_version,
    audit_kind: fields.audit_kind,
    audit_id: fields.audit_id,
    target_id: fields.target_id,
    action: fields.action,
    state_hash: fields.state_hash,
    prior_state_hash: fields.prior_state_hash,
    meta_payload: null,
    prev_hash: fields.prev_hash,
    entry_hash,
    key_id: fields.key_id,
    signature: signEntryHash(entry_hash, event.key),
    created_at: fields.created_at,
  };
}
