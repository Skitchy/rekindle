import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash, verify, type KeyObject } from "node:crypto";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RekindleStorage, ProvenanceWriteError } from "../sqlite.js";
import { prepareWriteContext, keyFromSeed, keyIdOf, TEST_SEED_ENV } from "../../provenance/keys.js";
import {
  entryHash,
  merkleRoot,
  sortMerkleLeaves,
  stateHash,
  type MerkleLeaf,
} from "../../provenance/canonical.js";
import { signEntryHash } from "../../provenance/chain.js";
import { buildBaselinePayload, manifestHash, parseBaselinePayload } from "../../provenance/baseline-format.js";
import { computeInventory } from "../../provenance/inventory.js";

// No test may reach the real /usr/bin/security (Phase 2 rule): the default mock throws.
const { unmocked } = vi.hoisted(() => ({
  unmocked: () => {
    throw new Error("unmocked execFileSync call");
  },
}));
vi.mock("node:child_process", () => ({ execFileSync: vi.fn(unmocked) }));
vi.mock("../../provenance/keys.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../provenance/keys.js")>();
  return { ...actual, prepareWriteContext: vi.fn(actual.prepareWriteContext) };
});

const mockedExec = vi.mocked(execFileSync);
const mockedPrepare = vi.mocked(prepareWriteContext);
const actualKeys = await vi.importActual<typeof import("../../provenance/keys.js")>("../../provenance/keys.js");

beforeAll(() => {
  expect(vi.isMockFunction(execFileSync)).toBe(true);
  expect(vi.isMockFunction(prepareWriteContext)).toBe(true);
});

// RFC 8032 test seeds (fixed bytes, noncanonical test keys only).
const SEED_1 = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const SEED_2 = "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb";
const KEY_1 = keyFromSeed(Buffer.from(SEED_1, "hex"));
const KEY_2 = keyFromSeed(Buffer.from(SEED_2, "hex"));
const KEY_ID_1 = keyIdOf(KEY_1);
const KEY_ID_2 = keyIdOf(KEY_2);
const STORE_A = "0123456789abcdef0123456789abcdef";
const STORE_B = "fedcba9876543210fedcba9876543210";
const ZERO_HASH = "0".repeat(64);

const AUTHORITATIVE = [
  "memories",
  "sessions",
  "memory_write_audit",
  "session_write_audit",
  "provenance_meta",
  "provenance_chain",
  "provenance_baseline_manifest",
];

let tmpDir: string;
let dbPath: string;
let storage: RekindleStorage;
let savedSeed: string | undefined;

function withConnection<T>(fn: (db: Database.Database) => T, options: Database.Options = {}): T {
  const db = new Database(dbPath, { fileMustExist: true, ...options });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function snapshot(): Record<string, unknown[]> {
  return withConnection(
    (db) => Object.fromEntries(AUTHORITATIVE.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])),
    { readonly: true },
  );
}

type ChainRowRecord = Record<string, unknown> & { seq: number; entry_hash: string; prev_hash: string; signature: string };

function chainRows(): ChainRowRecord[] {
  return withConnection(
    (db) => db.prepare(`SELECT * FROM provenance_chain ORDER BY seq`).all() as ChainRowRecord[],
    { readonly: true },
  );
}

// Test fixture only (Phase 5's baseline writes real baselines). Models what a baseline leaves behind:
// every live memory and session row gets a deterministic nonce if it has none, the manifest holds one
// leaf per row in MERKLE_SPEC order, and a signed baseline entry at seq 1 carries the Phase 5
// rekindle-baseline-v1 payload over those leaves and the pre-baseline inventory.
function seedChain(db: Database.Database, storeId = STORE_A, key: KeyObject = KEY_1, keyId = KEY_ID_1): void {
  const inventory_hash = computeInventory(db).hash;
  const leaves: MerkleLeaf[] = [];
  for (const [kind, table] of [["memory", "memories"], ["session", "sessions"]] as const) {
    for (const row of db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]) {
      let nonce = row.nonce as Buffer | null;
      if (nonce === null) {
        nonce = createHash("sha256").update(`fixture-nonce:${kind}:${row.id as string}`).digest();
        db.prepare(`UPDATE ${table} SET nonce = ? WHERE id = ?`).run(nonce, row.id);
      }
      const live = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id) as Record<string, unknown>;
      leaves.push({ kind, target_id: row.id as string, state_hash: stateHash(kind, nonce, live) });
    }
  }
  const ordered = sortMerkleLeaves(leaves);
  ordered.forEach((leaf, ordinal) =>
    db.prepare(`INSERT INTO provenance_baseline_manifest (ordinal, kind, target_id, state_hash) VALUES (?, ?, ?, ?)`).run(
      ordinal,
      leaf.kind,
      leaf.target_id,
      leaf.state_hash,
    ),
  );
  const meta_payload = buildBaselinePayload(ordered, inventory_hash);
  const fields = {
    seq: 1,
    store_id: storeId,
    format_version: 1,
    audit_kind: "baseline",
    audit_id: null,
    target_id: null,
    action: "baseline",
    state_hash: null,
    prior_state_hash: null,
    meta_payload,
    prev_hash: ZERO_HASH,
    key_id: keyId,
    created_at: "2026-10-11 00:00:00",
    client: null,
    thread_id: null,
    request_id: null,
    author_identity: null,
    authorization_reference: null,
    authorization_verified: 0,
  };
  const hash = entryHash(fields);
  db.prepare(
    `INSERT INTO provenance_chain (seq, store_id, format_version, audit_kind, audit_id, target_id, action, state_hash,
       prior_state_hash, meta_payload, prev_hash, entry_hash, key_id, signature, created_at)
     VALUES (1, ?, 1, 'baseline', NULL, NULL, 'baseline', NULL, NULL, ?, ?, ?, ?, ?, ?)`,
  ).run(storeId, meta_payload, ZERO_HASH, hash, keyId, signEntryHash(hash, key), fields.created_at);
  db.prepare(
    `UPDATE provenance_meta SET store_id = ?, format_version = 1, canonical = 0, active_key_id = ?, baseline_seq = 1,
       chain_enabled = 1 WHERE id = 1`,
  ).run(storeId, keyId);
}

// Every manifest leaf still matches its live row and the baseline payload's root and count.
function expectBaselineConsistent(): void {
  withConnection(
    (db) => {
      const leaves = db
        .prepare(`SELECT kind, target_id, state_hash FROM provenance_baseline_manifest ORDER BY ordinal`)
        .all() as MerkleLeaf[];
      const payload = parseBaselinePayload(
        (db.prepare(`SELECT meta_payload FROM provenance_chain WHERE seq = 1`).get() as { meta_payload: string }).meta_payload,
        1,
      );
      expect(payload.leaf_count).toBe(leaves.length);
      expect(payload.root).toBe(merkleRoot(leaves));
      expect(sortMerkleLeaves(leaves)).toEqual(leaves);
      // The payload binds exactly the persisted manifest.
      expect(payload.manifest_hash).toBe(manifestHash(leaves));
    },
    { readonly: true },
  );
}

// Recompute and check every non-baseline entry: seq contiguity, prev_hash links, entry_hash over the
// chain fields joined to the audit row's provenance, and Ed25519 over the raw 32-byte digest.
function verifyChain(publicKeys: Record<string, KeyObject> = { [KEY_ID_1]: KEY_1, [KEY_ID_2]: KEY_2 }): ChainRowRecord[] {
  const rows = chainRows();
  withConnection(
    (db) => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        expect(row.seq).toBe(i + 1);
        if (i === 0) continue;
        expect(row.prev_hash).toBe(rows[i - 1].entry_hash);
        const auditTable = row.audit_kind === "memory" ? "memory_write_audit" : "session_write_audit";
        const audit = db
          .prepare(
            `SELECT client, thread_id, request_id, author_identity, authorization_reference, authorization_verified, created_at
             FROM ${auditTable} WHERE id = ?`,
          )
          .get(row.audit_id) as Record<string, unknown>;
        expect(audit).toBeDefined();
        expect(audit.created_at).toBe(row.created_at);
        const { created_at: _c, ...provenance } = audit;
        const { signature: _s, entry_hash: _e, ...fields } = row;
        expect(entryHash({ ...fields, ...provenance })).toBe(row.entry_hash);
        const key = publicKeys[row.key_id as string];
        expect(verify(null, Buffer.from(row.entry_hash, "hex"), key, Buffer.from(row.signature, "hex"))).toBe(true);
        // The signature covers the raw digest, not its 64 ASCII characters.
        expect(verify(null, Buffer.from(row.entry_hash, "utf8"), key, Buffer.from(row.signature, "hex"))).toBe(false);
      }
    },
    { readonly: true },
  );
  return rows;
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ProvenanceWriteError);
    expect((e as ProvenanceWriteError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

function liveState(kind: "memory" | "session", id: string): string {
  return withConnection(
    (db) => {
      const row = db.prepare(`SELECT * FROM ${kind === "memory" ? "memories" : "sessions"} WHERE id = ?`).get(id) as Record<
        string,
        unknown
      >;
      return stateHash(kind, row.nonce as Uint8Array, row);
    },
    { readonly: true },
  );
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "rekindle-chained-"));
  dbPath = join(tmpDir, "db", "memories.db");
  mockedExec.mockReset();
  mockedExec.mockImplementation(unmocked);
  mockedPrepare.mockReset();
  mockedPrepare.mockImplementation(actualKeys.prepareWriteContext);
  savedSeed = process.env[TEST_SEED_ENV];
  process.env[TEST_SEED_ENV] = SEED_1;
  storage = new RekindleStorage(dbPath);
});

afterEach(() => {
  vi.restoreAllMocks();
  storage?.close();
  rmSync(tmpDir, { recursive: true, force: true });
  if (savedSeed === undefined) delete process.env[TEST_SEED_ENV];
  else process.env[TEST_SEED_ENV] = savedSeed;
});

describe("one signed entry per semantic write event", () => {
  beforeEach(() => {
    withConnection((db) => seedChain(db));
    expectBaselineConsistent();
  });

  it("store, update and delete each append one verified memory entry with one shared event_at", () => {
    const id = storage.store("chained memory", "lesson", 7, "rekindle");
    const stored = storage.get(id) as unknown as Record<string, unknown>;
    let rows = verifyChain();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ audit_kind: "memory", action: "store", target_id: id, prior_state_hash: null, key_id: KEY_ID_1 });
    expect(rows[1].state_hash).toBe(liveState("memory", id));
    expect(stored.created_at).toBe(rows[1].created_at);
    expect(stored.updated_at).toBe(rows[1].created_at);
    expect((stored.nonce as Buffer).length).toBe(32);

    expect(storage.update(id, { content: "chained memory, edited" })).toBe(true);
    rows = verifyChain();
    expect(rows[2]).toMatchObject({ action: "update", target_id: id, prior_state_hash: null });
    expect(rows[2].state_hash).toBe(liveState("memory", id));
    const updated = storage.get(id) as unknown as Record<string, unknown>;
    expect(updated.updated_at).toBe(rows[2].created_at);
    expect(updated.created_at).toBe(stored.created_at);
    expect(Buffer.compare(updated.nonce as Buffer, stored.nonce as Buffer)).toBe(0);

    const preDelete = liveState("memory", id);
    expect(storage.delete(id)).toBe(true);
    rows = verifyChain();
    expect(rows[3]).toMatchObject({ action: "delete", target_id: id, state_hash: null, prior_state_hash: preDelete });
    expect(storage.get(id)).toBeNull();
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("createSession and updateSession each append one verified session entry", () => {
    const id = storage.createSession({ summary: "chained session", project: "rekindle" });
    const created = storage.getSession(id) as unknown as Record<string, unknown>;
    let rows = verifyChain();
    expect(rows[1]).toMatchObject({ audit_kind: "session", action: "create", target_id: id });
    expect(rows[1].state_hash).toBe(liveState("session", id));
    expect(created.started_at).toBe(rows[1].created_at);
    expect(created.ended_at).toBe(rows[1].created_at);

    expect(storage.updateSession(id, { summary: "updated" })).toBe(true);
    rows = verifyChain();
    expect(rows[2]).toMatchObject({ audit_kind: "session", action: "update", target_id: id });
    expect(rows[2].state_hash).toBe(liveState("session", id));
    // Session updates set no domain timestamp.
    expect((storage.getSession(id) as unknown as Record<string, unknown>).started_at).toBe(created.started_at);
  });

  it("every domain, audit and chain timestamp is the app's event_at, never a DB default", () => {
    // Pin the app clock to a past instant so any DB-default timestamp (real now) would differ.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2001-02-03T04:05:06Z"));
    try {
      const id = storage.store("timed", "lesson");
      storage.update(id, { content: "timed again" });
      const sessionId = storage.createSession({ summary: "timed" });
      storage.updateSession(sessionId, { summary: "timed again" });
      storage.delete(id);
    } finally {
      vi.useRealTimers();
    }
    const at = "2001-02-03 04:05:06";
    const after = snapshot();
    for (const table of ["memory_write_audit", "session_write_audit"]) {
      for (const row of after[table] as Record<string, unknown>[]) expect(row.created_at).toBe(at);
    }
    for (const row of (after.provenance_chain as Record<string, unknown>[]).slice(1)) expect(row.created_at).toBe(at);
    const session = after.sessions[0] as Record<string, unknown>;
    expect([session.started_at, session.ended_at]).toEqual([at, at]);
    verifyChain();
  });

  it("a batch links each entry to the one appended immediately before it", () => {
    storage.semanticWrite(() => {
      const sessionId = storage.createSession({ summary: "" });
      const id = storage.store("in batch", "context");
      storage.update(id, { importance: 9 });
      storage.updateSession(sessionId, { summary: "done" });
    });
    const rows = verifyChain();
    expect(rows.map((r) => r.action)).toEqual(["baseline", "create", "store", "update", "update"]);
    expect(mockedPrepare).toHaveBeenCalledTimes(1);
  });

  it("a rolled-back nested write leaves no entry and the next entry still links to the real head", () => {
    storage.semanticWrite(() => {
      storage.store("kept 1");
      try {
        storage.semanticWrite(() => {
          storage.store("rolled back");
          throw new Error("inner failure");
        });
      } catch {
        // inner savepoint rolled back, including its chain entry
      }
      storage.store("kept 2");
    });
    const rows = verifyChain();
    expect(rows).toHaveLength(3);
    expect(storage.list().map((m) => m.content).sort()).toEqual(["kept 1", "kept 2"]);
  });
});

describe("pre-state checks for update and delete", () => {
  beforeEach(() => withConnection((db) => seedChain(db)));

  it.each(["update", "delete"] as const)("edit-then-%s via another connection fails with unchained_edit and no mutation", (action) => {
    const id = storage.store("original", "lesson");
    withConnection((db) => db.prepare(`UPDATE memories SET content = 'tampered' WHERE id = ?`).run(id));
    const before = snapshot();
    expectCode(() => (action === "update" ? storage.update(id, { importance: 2 }) : storage.delete(id)), "unchained_edit");
    expect(snapshot()).toEqual(before);
  });

  it("a session edited outside the chain cannot be updated", () => {
    const id = storage.createSession({ summary: "s" });
    withConnection((db) => db.prepare(`UPDATE sessions SET gap_count = 5 WHERE id = ?`).run(id));
    const before = snapshot();
    expectCode(() => storage.updateSession(id, { summary: "x" }), "unchained_edit");
    expect(snapshot()).toEqual(before);
  });

  it("a never-existing target keeps today's false with no audit and no entry", () => {
    const before = snapshot();
    expect(storage.update("missing", { content: "x" })).toBe(false);
    expect(storage.delete("missing")).toBe(false);
    expect(storage.updateSession("missing", { summary: "x" })).toBe(false);
    expect(snapshot()).toEqual(before);
  });

  it("a target whose latest entry is a delete is absent: false, no audit, no entry", () => {
    const id = storage.store("to delete");
    storage.delete(id);
    const before = snapshot();
    expect(storage.update(id, { content: "x" })).toBe(false);
    expect(storage.delete(id)).toBe(false);
    expect(snapshot()).toEqual(before);
  });

  it("a live row with no chained state fails with unchained_edit", () => {
    withConnection((db) => db.prepare(`INSERT INTO memories (id, content, nonce) VALUES ('sneaky', 'x', ?)`).run(Buffer.alloc(32, 9)));
    const before = snapshot();
    expectCode(() => storage.update("sneaky", { content: "y" }), "unchained_edit");
    expectCode(() => storage.delete("sneaky"), "unchained_edit");
    expect(snapshot()).toEqual(before);
  });

  it("a row removed outside the chain fails with unchained_edit", () => {
    const id = storage.store("present");
    withConnection((db) => db.prepare(`DELETE FROM memories WHERE id = ?`).run(id));
    const before = snapshot();
    expectCode(() => storage.update(id, { content: "y" }), "unchained_edit");
    expectCode(() => storage.delete(id), "unchained_edit");
    expect(snapshot()).toEqual(before);
  });

  it("a row whose nonce was removed fails with unchained_edit", () => {
    const id = storage.store("present");
    withConnection((db) => db.prepare(`UPDATE memories SET nonce = NULL WHERE id = ?`).run(id));
    expectCode(() => storage.update(id, { content: "y" }), "unchained_edit");
  });

});

describe("pre-baseline rows covered by the manifest", () => {
  // Rows created before the baseline (through the disabled path), then a baseline over them.
  let preMemory: string;
  let preOther: string;
  let preSession: string;

  beforeEach(() => {
    preMemory = storage.store("from before the baseline", "lesson");
    preOther = storage.store("another pre-baseline memory", "context");
    preSession = storage.createSession({ summary: "pre-baseline session" });
    withConnection((db) => seedChain(db));
    expectBaselineConsistent();
  });

  it("a manifest leaf is the latest state until the target has its own entry", () => {
    expect(storage.update(preMemory, { content: "first chained edit" })).toBe(true);
    expect(storage.update(preMemory, { content: "second chained edit" })).toBe(true);
    expect(storage.updateSession(preSession, { summary: "chained session edit" })).toBe(true);
    expect(storage.delete(preOther)).toBe(true);
    const rows = verifyChain();
    expect(rows.map((r) => r.action)).toEqual(["baseline", "update", "update", "update", "delete"]);
  });

  it("a pre-baseline row edited outside the chain fails with unchained_edit", () => {
    withConnection((db) => db.prepare(`UPDATE memories SET content = 'tampered' WHERE id = ?`).run(preOther));
    const before = snapshot();
    expectCode(() => storage.delete(preOther), "unchained_edit");
    expectCode(() => storage.update(preOther, { importance: 1 }), "unchained_edit");
    expect(snapshot()).toEqual(before);
  });
});

describe("context and chain checks under the lock", () => {
  it("a key rotated between prepare and lock re-prepares once and succeeds with the new key", () => {
    withConnection((db) => seedChain(db));
    let calls = 0;
    mockedPrepare.mockImplementation((options) => {
      calls++;
      const ctx = actualKeys.prepareWriteContext(options);
      if (calls === 1) {
        // After the first prepare: another process rotates to KEY_2 and commits.
        withConnection((db) => db.prepare(`UPDATE provenance_meta SET active_key_id = ? WHERE id = 1`).run(KEY_ID_2));
        process.env[TEST_SEED_ENV] = SEED_2;
      }
      return ctx;
    });
    const id = storage.store("written after rotation");
    expect(calls).toBe(2);
    const rows = verifyChain();
    expect(rows[1]).toMatchObject({ target_id: id, key_id: KEY_ID_2 });
  });

  it("a store_id change between prepare and lock re-prepares once and succeeds against the current store", () => {
    // The chain belongs to STORE_B; meta briefly names STORE_A when the first context is prepared.
    withConnection((db) => {
      seedChain(db, STORE_B);
      db.prepare(`UPDATE provenance_meta SET store_id = ? WHERE id = 1`).run(STORE_A);
    });
    let calls = 0;
    mockedPrepare.mockImplementation((options) => {
      calls++;
      const ctx = actualKeys.prepareWriteContext(options);
      if (calls === 1) withConnection((db) => db.prepare(`UPDATE provenance_meta SET store_id = ? WHERE id = 1`).run(STORE_B));
      return ctx;
    });
    storage.store("written to the current store");
    expect(calls).toBe(2);
    expect(mockedPrepare.mock.calls.map((c) => c[0].store_id)).toEqual([STORE_A, STORE_B]);
    expect(verifyChain()[1].store_id).toBe(STORE_B);
  });

  it("a second mismatch throws reprepare_required with no mutation", () => {
    withConnection((db) => seedChain(db));
    const before = snapshot();
    // The store rotates to KEY_2 after the first prepare, but this process can still only load KEY_1,
    // so the fresh context on the retry is stale too.
    let calls = 0;
    mockedPrepare.mockImplementation((options) => {
      calls++;
      const ctx = actualKeys.prepareWriteContext(options);
      if (calls === 1) {
        withConnection((db) => db.prepare(`UPDATE provenance_meta SET active_key_id = ? WHERE id = 1`).run(KEY_ID_2));
      }
      return ctx;
    });
    const operation = vi.fn();
    expectCode(() => storage.semanticWrite(operation), "reprepare_required");
    expect(operation).not.toHaveBeenCalled();
    expect(mockedPrepare).toHaveBeenCalledTimes(2);
    const after = snapshot();
    expect(Object.fromEntries(Object.entries(after).filter(([t]) => t !== "provenance_meta"))).toEqual(
      Object.fromEntries(Object.entries(before).filter(([t]) => t !== "provenance_meta")),
    );
  });

  it("rotation from another connection cannot commit while a chained batch holds the lock", () => {
    withConnection((db) => seedChain(db));
    storage.semanticWrite(() => {
      withConnection(
        (db) => expect(() => db.prepare(`UPDATE provenance_meta SET active_key_id = ? WHERE id = 1`).run(KEY_ID_2)).toThrow(
          /SQLITE_BUSY|database is locked/,
        ),
        { timeout: 0 },
      );
      storage.store("written under the lock");
    });
    expect(verifyChain()[1].key_id).toBe(KEY_ID_1);
  });

  it("the Phase 3 hint race now succeeds on its retry", () => {
    const realHint = (RekindleStorage.prototype as unknown as { readChainEnabledHint(this: RekindleStorage): boolean })
      .readChainEnabledHint;
    const order: string[] = [];
    vi.spyOn(RekindleStorage.prototype as unknown as { readChainEnabledHint(): boolean }, "readChainEnabledHint").mockImplementation(
      function (this: RekindleStorage) {
        const stale = realHint.call(this);
        order.push(`hint:${stale}`);
        withConnection((db) => seedChain(db));
        order.push("enabled");
        return stale;
      },
    );
    mockedPrepare.mockImplementation((options) => {
      order.push("prepare");
      return actualKeys.prepareWriteContext(options);
    });
    const id = storage.store("after the race");
    expect(order).toEqual(["hint:false", "enabled", "prepare"]);
    expect(verifyChain()[1].target_id).toBe(id);
  });

  it("an enabled store with an empty chain fails closed with chain_head_missing", () => {
    withConnection((db) =>
      db.prepare(
        `UPDATE provenance_meta SET store_id = ?, format_version = 1, canonical = 0, active_key_id = ?, baseline_seq = 1,
           chain_enabled = 1 WHERE id = 1`,
      ).run(STORE_A, KEY_ID_1),
    );
    const before = snapshot();
    expectCode(() => storage.store("x"), "chain_head_missing");
    expect(snapshot()).toEqual(before);
  });

  it("a head that belongs to another store fails closed with chain_head_invalid", () => {
    withConnection((db) => {
      seedChain(db);
      db.prepare(
        `INSERT INTO provenance_chain (seq, store_id, format_version, audit_kind, action, meta_payload, prev_hash, entry_hash,
           key_id, signature, created_at)
         VALUES (2, ?, 1, 'key_rotate', 'key_rotate', '{}', ?, ?, ?, 'sig', 'now')`,
      ).run(STORE_B, ZERO_HASH, ZERO_HASH, KEY_ID_1);
    });
    const before = snapshot();
    expectCode(() => storage.store("x"), "chain_head_invalid");
    expect(snapshot()).toEqual(before);
  });

  it("a chain whose tail row was deleted fails closed with chain_head_invalid", () => {
    withConnection((db) => seedChain(db));
    storage.store("one");
    storage.store("two");
    withConnection((db) => db.prepare(`DELETE FROM provenance_chain WHERE seq = 3`).run());
    const before = snapshot();
    expectCode(() => storage.store("x"), "chain_head_invalid");
    expect(snapshot()).toEqual(before);
  });

  it.each([
    ["a baseline_seq that names a non-baseline entry", "UPDATE provenance_meta SET baseline_seq = 2 WHERE id = 1"],
    ["a baseline_seq that names no entry", "UPDATE provenance_meta SET baseline_seq = 99 WHERE id = 1"],
    ["a baseline entry from another store", "UPDATE provenance_chain SET store_id = 'fedcba9876543210fedcba9876543210' WHERE seq = 1"],
  ])("%s fails closed with baseline_invalid", (_name, sql) => {
    withConnection((db) => seedChain(db));
    storage.store("entry two");
    withConnection((db) => db.prepare(sql).run());
    const before = snapshot();
    expectCode(() => storage.store("x"), "baseline_invalid");
    expect(snapshot()).toEqual(before);
  });
});

describe("no partial rows when any step fails", () => {
  beforeEach(() => withConnection((db) => seedChain(db)));

  const inject = (trigger: string) => withConnection((db) => db.exec(trigger));

  it.each([
    ["BEFORE INSERT ON memories", "store"],
    ["AFTER INSERT ON memories", "store"],
    ["BEFORE INSERT ON memory_write_audit", "store"],
    ["AFTER INSERT ON memory_write_audit", "store"],
    ["BEFORE INSERT ON provenance_chain", "store"],
    ["AFTER INSERT ON provenance_chain", "store"],
    ["BEFORE UPDATE ON memories", "update"],
    ["AFTER UPDATE ON memories", "update"],
    ["BEFORE INSERT ON provenance_chain", "update"],
    ["BEFORE DELETE ON memories", "delete"],
    ["AFTER DELETE ON memories", "delete"],
    ["AFTER INSERT ON provenance_chain", "delete"],
    ["BEFORE INSERT ON sessions", "createSession"],
    ["AFTER INSERT ON session_write_audit", "createSession"],
    ["BEFORE INSERT ON provenance_chain", "createSession"],
  ])("%s during %s leaves every authoritative table unchanged", (when, action) => {
    const id = storage.store("pre-existing");
    const before = snapshot();
    inject(`CREATE TRIGGER inj ${when} BEGIN SELECT RAISE(ABORT, 'injected'); END`);
    const run = {
      store: () => storage.store("must not persist"),
      update: () => storage.update(id, { content: "must not persist" }),
      delete: () => storage.delete(id),
      createSession: () => storage.createSession({ summary: "must not persist" }),
    }[action] as () => unknown;
    expect(run).toThrow("injected");
    inject("DROP TRIGGER inj");
    expect(snapshot()).toEqual(before);
  });
});

describe("operational and disabled paths", () => {
  it("search appends nothing, and a later update still passes its pre-state check", () => {
    withConnection((db) => seedChain(db));
    const id = storage.store("searchable water lesson", "lesson");
    const entries = chainRows().length;
    expect(storage.search("water").map((r) => r.id)).toEqual([id]);
    expect(storage.get(id)?.retrieval_count).toBe(1);
    expect(chainRows()).toHaveLength(entries);
    expect(storage.update(id, { importance: 8 })).toBe(true);
    verifyChain();
  });

  it("a disabled store keeps existing write behavior: no prepare, no keychain, no entries, no nonces", () => {
    const id = storage.store("plain", "general");
    storage.update(id, { content: "plain edited" });
    const sessionId = storage.createSession({ summary: "plain" });
    storage.updateSession(sessionId, { summary: "plain edited" });
    storage.delete(id);
    expect(mockedPrepare).not.toHaveBeenCalled();
    expect(mockedExec).not.toHaveBeenCalled();
    const after = snapshot();
    expect(after.provenance_chain).toEqual([]);
    expect((after.sessions[0] as Record<string, unknown>).nonce).toBeNull();
  });
});
