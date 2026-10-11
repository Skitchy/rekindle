import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RekindleStorage, ProvenanceWriteError } from "../sqlite.js";
import { prepareWriteContext, TEST_SEED_ENV } from "../../provenance/keys.js";

// No test may reach the real /usr/bin/security (Phase 2 rule): the default mock throws.
const { unmocked } = vi.hoisted(() => ({
  unmocked: () => {
    throw new Error("unmocked execFileSync call");
  },
}));
vi.mock("node:child_process", () => ({ execFileSync: vi.fn(unmocked) }));

// prepareWriteContext keeps its real behavior; the wrapper records each call.
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

// Frozen copy of the pre-Phase-3 schema and migrations, from exact commit 6040e86
// (src/storage/sqlite.ts lines 72-142 and 166-178), not from the current constants.
const FROZEN_SCHEMA_6040E86 = `
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    category TEXT DEFAULT 'general'
        CHECK (category IN ('preference','lesson','context','relationship','general')),
    importance INTEGER DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
    project TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    retrieval_count INTEGER DEFAULT 0,
    last_accessed TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content,
    category,
    project,
    content='memories',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content, category, project)
    VALUES (new.rowid, new.content, new.category, new.project);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, category, project)
    VALUES ('delete', old.rowid, old.content, old.category, old.project);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, category, project)
    VALUES ('delete', old.rowid, old.content, old.category, old.project);
    INSERT INTO memories_fts(rowid, content, category, project)
    VALUES (new.rowid, new.content, new.category, new.project);
END;

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT,
    summary TEXT,
    transcript_path TEXT
);

CREATE TABLE IF NOT EXISTS memory_write_audit (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('store','update','delete')),
    client TEXT,
    thread_id TEXT,
    request_id TEXT,
    author_identity TEXT,
    authorization_reference TEXT,
    authorization_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_write_audit (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('create','update')),
    client TEXT,
    thread_id TEXT,
    request_id TEXT,
    author_identity TEXT,
    authorization_reference TEXT,
    authorization_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
`;
const FROZEN_MIGRATIONS_6040E86 = [
      "ALTER TABLE memories ADD COLUMN type TEXT DEFAULT 'memory'",
      "ALTER TABLE memories ADD COLUMN source TEXT DEFAULT 'manual'",
      "ALTER TABLE memories ADD COLUMN session_id TEXT",
      "ALTER TABLE sessions ADD COLUMN project TEXT",
      "ALTER TABLE sessions ADD COLUMN checkpoint_memory_id TEXT",
      "ALTER TABLE sessions ADD COLUMN gap_count INTEGER DEFAULT 0",
      "ALTER TABLE sessions ADD COLUMN orientation_score INTEGER",
      "ALTER TABLE memories ADD COLUMN writer_client TEXT",
      "ALTER TABLE memories ADD COLUMN writer_thread_id TEXT",
      "ALTER TABLE memories ADD COLUMN request_id TEXT",
      "ALTER TABLE memories ADD COLUMN author_identity TEXT",
      "ALTER TABLE memories ADD COLUMN authorization_reference TEXT",
      "ALTER TABLE memories ADD COLUMN authorization_verified INTEGER NOT NULL DEFAULT 0",
];

const AUTHORITATIVE = [
  "memories",
  "sessions",
  "memory_write_audit",
  "session_write_audit",
  "provenance_meta",
  "provenance_chain",
  "provenance_baseline_manifest",
];
const TEST_SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const STORE_ID = "0123456789abcdef0123456789abcdef";
const KEY_ID = "a".repeat(64);
const HASH = "b".repeat(64);

let tmpDir: string;
let dbPath: string;
let storage: RekindleStorage;
let savedSeed: string | undefined;

function connect(options: Database.Options = {}): Database.Database {
  return new Database(dbPath, { fileMustExist: true, ...options });
}

function withConnection<T>(fn: (db: Database.Database) => T, options: Database.Options = {}): T {
  const db = connect(options);
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

function enableChain(db: Database.Database): void {
  db.prepare(
    `UPDATE provenance_meta SET store_id = ?, format_version = 1, canonical = 0, active_key_id = ?,
       baseline_seq = 1, chain_enabled = 1 WHERE id = 1`,
  ).run(STORE_ID, KEY_ID);
}

function setLock(db: Database.Database): void {
  db.prepare(
    `UPDATE provenance_meta SET maintenance_lock_token = ?, maintenance_lock_started_at = ? WHERE id = 1`,
  ).run("c".repeat(32), "2026-10-11 22:00:00");
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

function hintSpy() {
  return vi.spyOn(RekindleStorage.prototype as unknown as { readChainEnabledHint(): boolean }, "readChainEnabledHint");
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "rekindle-semantic-"));
  dbPath = join(tmpDir, "db", "memories.db");
  mockedExec.mockReset();
  mockedExec.mockImplementation(unmocked);
  mockedPrepare.mockReset();
  mockedPrepare.mockImplementation(actualKeys.prepareWriteContext);
  savedSeed = process.env[TEST_SEED_ENV];
  delete process.env[TEST_SEED_ENV];
});

afterEach(() => {
  vi.restoreAllMocks();
  storage?.close();
  rmSync(tmpDir, { recursive: true, force: true });
  if (savedSeed === undefined) delete process.env[TEST_SEED_ENV];
  else process.env[TEST_SEED_ENV] = savedSeed;
});

describe("migration", () => {
  function createOldStore(): void {
    mkdirSync(join(tmpDir, "db"), { recursive: true });
    const old = new Database(dbPath);
    try {
      old.pragma("journal_mode = WAL");
      old.exec(FROZEN_SCHEMA_6040E86);
      for (const sql of FROZEN_MIGRATIONS_6040E86) old.exec(sql);
      old.prepare(
        `INSERT INTO memories (id, content, category, importance, project, created_at, updated_at, retrieval_count,
           last_accessed, type, source, session_id, writer_client, writer_thread_id, request_id, author_identity,
           authorization_reference, authorization_verified)
         VALUES ('m1', 'old memory', 'lesson', 7, 'rekindle', '2026-01-01 00:00:00', '2026-01-02 00:00:00', 4,
           '2026-01-03 00:00:00', 'checkpoint', 'end_session', 's1', 'cc', 't1', 'r1', 'cc', 'room:1', 0)`,
      ).run();
      old.prepare(`INSERT INTO memories (id, content) VALUES ('m2', 'minimal old memory')`).run();
      old.prepare(
        `INSERT INTO sessions (id, started_at, ended_at, summary, transcript_path, project, checkpoint_memory_id,
           gap_count, orientation_score)
         VALUES ('s1', '2026-01-01 00:00:00', '2026-01-01 01:00:00', 'old session', 'x.md', 'rekindle', 'm1', 2, 80)`,
      ).run();
      old.prepare(
        `INSERT INTO memory_write_audit (id, memory_id, action, client) VALUES ('a1', 'm1', 'store', 'cc')`,
      ).run();
      old.prepare(
        `INSERT INTO session_write_audit (id, session_id, action, client) VALUES ('a2', 's1', 'create', 'cc')`,
      ).run();
    } finally {
      old.close();
    }
  }

  const OLD_TABLES = ["memories", "sessions", "memory_write_audit", "session_write_audit"];

  function oldRows(): Record<string, unknown[]> {
    return withConnection(
      (db) =>
        Object.fromEntries(
          OLD_TABLES.map((t) => {
            const rows = db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all() as Record<string, unknown>[];
            return [t, rows.map(({ nonce: _n, ...rest }) => rest)];
          }),
        ),
      { readonly: true },
    );
  }

  it("upgrades a frozen pre-Phase-3 store with its rows and data intact", () => {
    createOldStore();
    const before = oldRows();
    expect(before.memories).toHaveLength(2);

    storage = new RekindleStorage(dbPath);
    expect(oldRows()).toEqual(before);
    const after = snapshot();
    expect(after.provenance_meta).toEqual([
      {
        id: 1,
        store_id: null,
        format_version: null,
        canonical: null,
        active_key_id: null,
        chain_enabled: 0,
        baseline_seq: null,
        maintenance_lock_token: null,
        maintenance_lock_started_at: null,
      },
    ]);
    expect(after.provenance_chain).toEqual([]);
    expect(after.provenance_baseline_manifest).toEqual([]);
    for (const row of [...after.memories, ...after.sessions] as Record<string, unknown>[]) {
      expect(row.nonce).toBeNull();
    }
  });

  it("is idempotent on an upgraded old store and on a new store", () => {
    createOldStore();
    storage = new RekindleStorage(dbPath);
    const once = snapshot();
    storage.close();
    storage = new RekindleStorage(dbPath);
    expect(snapshot()).toEqual(once);

    storage.close();
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = mkdtempSync(join(tmpdir(), "rekindle-semantic-"));
    dbPath = join(tmpDir, "db", "memories.db");
    storage = new RekindleStorage(dbPath);
    const fresh = snapshot();
    storage.close();
    storage = new RekindleStorage(dbPath);
    expect(snapshot()).toEqual(fresh);
    expect(fresh.provenance_meta).toHaveLength(1);
  });

  it("the fixture really is the old schema: no provenance tables or nonce columns", () => {
    createOldStore();
    withConnection(
      (db) => {
        const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(
          (r) => r.name,
        );
        expect(tables.some((t) => t.startsWith("provenance_"))).toBe(false);
        const columns = (db.prepare(`PRAGMA table_info(memories)`).all() as { name: string }[]).map((c) => c.name);
        expect(columns).not.toContain("nonce");
      },
      { readonly: true },
    );
  });
});

describe("schema checks", () => {
  beforeEach(() => {
    storage = new RekindleStorage(dbPath);
  });

  const rejects = (sql: string, ...params: unknown[]) =>
    withConnection((db) => expect(() => db.prepare(sql).run(...params)).toThrow(/CHECK constraint failed|UNIQUE/));
  const accepts = (sql: string, ...params: unknown[]) =>
    withConnection((db) => expect(() => db.prepare(sql).run(...params)).not.toThrow());

  it("provenance_meta holds exactly one row", () => {
    rejects(`INSERT INTO provenance_meta (id) VALUES (2)`);
    withConnection((db) => expect(() => db.prepare(`INSERT INTO provenance_meta (id) VALUES (1)`).run()).toThrow(/UNIQUE|PRIMARY KEY/));
  });

  it.each([
    ["store_id uppercase", "store_id", STORE_ID.toUpperCase()],
    ["store_id 31 chars", "store_id", STORE_ID.slice(0, 31)],
    ["store_id non-hex", "store_id", `${STORE_ID.slice(0, 31)}g`],
    ["store_id integer", "store_id", 12345678901234],
    ["format_version 2", "format_version", 2],
    ["canonical 2", "canonical", 2],
    ["canonical non-numeric text", "canonical", "yes"],
    ["active_key_id 63 chars", "active_key_id", KEY_ID.slice(0, 63)],
    ["active_key_id uppercase", "active_key_id", KEY_ID.toUpperCase()],
    ["chain_enabled 2", "chain_enabled", 2],
    ["baseline_seq non-numeric text", "baseline_seq", "first"],
  ])("provenance_meta rejects %s", (_name, column, value) => {
    rejects(`UPDATE provenance_meta SET ${column} = ? WHERE id = 1`, value);
  });

  it("INTEGER affinity stores numeric text such as '1' as an integer before the CHECK runs", () => {
    accepts(`UPDATE provenance_meta SET canonical = '1', baseline_seq = '7' WHERE id = 1`);
    const row = withConnection(
      (db) => db.prepare(`SELECT typeof(canonical) AS c, typeof(baseline_seq) AS b FROM provenance_meta`).get(),
      { readonly: true },
    );
    expect(row).toEqual({ c: "integer", b: "integer" });
  });

  it("provenance_meta accepts well-formed prepared values", () => {
    accepts(
      `UPDATE provenance_meta SET store_id = ?, format_version = 1, canonical = 1, active_key_id = ?, baseline_seq = 7 WHERE id = 1`,
      STORE_ID,
      KEY_ID,
    );
  });

  it("the maintenance lock pair is all-null or all-set", () => {
    rejects(`UPDATE provenance_meta SET maintenance_lock_token = 'x' WHERE id = 1`);
    rejects(`UPDATE provenance_meta SET maintenance_lock_started_at = 'x' WHERE id = 1`);
    accepts(`UPDATE provenance_meta SET maintenance_lock_token = 'x', maintenance_lock_started_at = 'y' WHERE id = 1`);
  });

  it.each(["store_id", "format_version", "canonical", "active_key_id", "baseline_seq"])(
    "chain_enabled = 1 requires %s",
    (missing) => {
      withConnection((db) => enableChain(db));
      rejects(`UPDATE provenance_meta SET ${missing} = NULL WHERE id = 1`);
      withConnection((db) => db.prepare(`UPDATE provenance_meta SET chain_enabled = 0 WHERE id = 1`).run());
      accepts(`UPDATE provenance_meta SET ${missing} = NULL WHERE id = 1`);
      rejects(`UPDATE provenance_meta SET chain_enabled = 1 WHERE id = 1`);
    },
  );

  const chainRow = (overrides: Record<string, unknown>) => {
    const row: Record<string, unknown> = {
      store_id: STORE_ID,
      format_version: 1,
      audit_kind: "memory",
      audit_id: "a1",
      target_id: "m1",
      action: "store",
      state_hash: HASH,
      prior_state_hash: null,
      meta_payload: null,
      prev_hash: HASH,
      entry_hash: HASH,
      key_id: KEY_ID,
      signature: "sig",
      created_at: "2026-10-11 22:00:00",
      ...overrides,
    };
    const columns = Object.keys(row);
    return [
      `INSERT INTO provenance_chain (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      ...Object.values(row),
    ] as const;
  };
  const meta = { audit_id: null, target_id: null, state_hash: null, meta_payload: "{}" };

  it.each([
    ["memory store", {}],
    ["memory update", { action: "update" }],
    ["memory delete", { action: "delete", state_hash: null, prior_state_hash: HASH }],
    ["session create", { audit_kind: "session", action: "create" }],
    ["session update", { audit_kind: "session", action: "update" }],
    ["baseline", { audit_kind: "baseline", action: "baseline", ...meta }],
    ["key_rotate", { audit_kind: "key_rotate", action: "key_rotate", ...meta }],
  ])("provenance_chain accepts a well-formed %s entry", (_name, overrides) => {
    const [sql, ...params] = chainRow(overrides);
    accepts(sql, ...params);
  });

  it.each([
    ["an unknown kind", { audit_kind: "journal" }],
    ["format_version 2", { format_version: 2 }],
    ["memory with a session action", { action: "create" }],
    ["memory store without audit_id", { audit_id: null }],
    ["memory store without target_id", { target_id: null }],
    ["memory store without state_hash", { state_hash: null }],
    ["memory store with prior_state_hash", { prior_state_hash: HASH }],
    ["memory store with meta_payload", { meta_payload: "{}" }],
    ["memory delete with state_hash", { action: "delete", prior_state_hash: HASH }],
    ["memory delete without prior_state_hash", { action: "delete", state_hash: null }],
    ["session delete", { audit_kind: "session", action: "delete", state_hash: null, prior_state_hash: HASH }],
    ["session store", { audit_kind: "session", action: "store" }],
    ["baseline without meta_payload", { audit_kind: "baseline", action: "baseline", ...meta, meta_payload: null }],
    ["baseline with a target", { audit_kind: "baseline", action: "baseline", ...meta, target_id: "m1" }],
    ["baseline with state_hash", { audit_kind: "baseline", action: "baseline", ...meta, state_hash: HASH }],
    ["baseline with the wrong action", { audit_kind: "baseline", action: "key_rotate", ...meta }],
    ["key_rotate with an audit_id", { audit_kind: "key_rotate", action: "key_rotate", ...meta, audit_id: "a1" }],
  ])("provenance_chain rejects %s", (_name, overrides) => {
    const [sql, ...params] = chainRow(overrides);
    withConnection((db) => expect(() => db.prepare(sql).run(...params)).toThrow(/CHECK constraint failed/));
  });

  it("provenance_baseline_manifest checks kind, hash and uniqueness", () => {
    const insert = `INSERT INTO provenance_baseline_manifest (ordinal, kind, target_id, state_hash) VALUES (?, ?, ?, ?)`;
    accepts(insert, 0, "memory", "m1", HASH);
    accepts(insert, 1, "session", "m1", HASH);
    rejects(insert, 2, "journal", "m2", HASH);
    rejects(insert, 3, "memory", "m3", HASH.toUpperCase());
    rejects(insert, 4, "memory", "m4", HASH.slice(0, 63));
    rejects(insert, 5, "memory", "m1", HASH);
  });

  it.each(["memories", "sessions"])("%s.nonce is NULL or a 32-byte blob", (table) => {
    if (table === "memories") storage.store("row", "general");
    else storage.createSession({ summary: "row" });
    accepts(`UPDATE ${table} SET nonce = NULL`);
    accepts(`UPDATE ${table} SET nonce = ?`, Buffer.alloc(32, 1));
    rejects(`UPDATE ${table} SET nonce = ?`, Buffer.alloc(31, 1));
    rejects(`UPDATE ${table} SET nonce = ?`, Buffer.alloc(33, 1));
    rejects(`UPDATE ${table} SET nonce = ?`, "x".repeat(32));
  });
});

describe("semantic writes on a disabled store", () => {
  beforeEach(() => {
    storage = new RekindleStorage(dbPath);
  });

  it("every writer works with no store_id and no key, and never prepares or touches the keychain", () => {
    const id = storage.store("a memory", "lesson", 6, "rekindle");
    expect(storage.update(id, { content: "edited" })).toBe(true);
    expect(storage.update("missing", { content: "x" })).toBe(false);
    const sessionId = storage.createSession({ summary: "s", project: "rekindle" });
    expect(storage.updateSession(sessionId, { summary: "s2" })).toBe(true);
    expect(storage.updateSession("missing", { summary: "x" })).toBe(false);
    expect(storage.delete(id)).toBe(true);
    expect(storage.delete(id)).toBe(false);

    expect(storage.get(id)).toBeNull();
    expect(storage.getSession(sessionId)?.summary).toBe("s2");
    expect(storage.listWriteAudit(id).map((r) => r.action)).toEqual(["store", "update", "delete"]);
    expect(storage.listSessionWriteAudit(sessionId).map((r) => r.action)).toEqual(["create", "update"]);
    expect(mockedPrepare).not.toHaveBeenCalled();
    expect(mockedExec).not.toHaveBeenCalled();
    const after = snapshot();
    expect(after.provenance_chain).toEqual([]);
    expect((after.provenance_meta[0] as Record<string, unknown>).store_id).toBeNull();
  });
});

describe("maintenance lock", () => {
  beforeEach(() => {
    storage = new RekindleStorage(dbPath);
  });

  it("every semantic writer refuses with no mutation while the lock is set from another connection", () => {
    const id = storage.store("pre-existing", "context", 5, "rekindle");
    const sessionId = storage.createSession({ summary: "pre-existing" });
    withConnection(setLock);
    const before = snapshot();

    expectCode(() => storage.store("blocked"), "maintenance_locked");
    expectCode(() => storage.update(id, { content: "blocked" }), "maintenance_locked");
    expectCode(() => storage.delete(id), "maintenance_locked");
    expectCode(() => storage.createSession({ summary: "blocked" }), "maintenance_locked");
    expectCode(() => storage.updateSession(sessionId, { summary: "blocked" }), "maintenance_locked");
    const operation = vi.fn();
    expectCode(() => storage.semanticWrite(operation), "maintenance_locked");
    expect(operation).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it("search is the explicit exception: it still returns and still counts retrievals", () => {
    const id = storage.store("searchable lesson about water", "lesson", 5);
    withConnection(setLock);
    const results = storage.search("water");
    expect(results.map((r) => r.id)).toEqual([id]);
    expect(storage.get(id)?.retrieval_count).toBe(1);
  });

  it("setting the lock cannot pass an in-flight writer: BUSY at timeout 0, then succeeds after it commits", () => {
    const writer = connect();
    const locker = connect({ timeout: 0 });
    try {
      writer.exec("BEGIN IMMEDIATE");
      writer.prepare(`INSERT INTO memories (id, content) VALUES ('in-flight', 'x')`).run();
      expect(() => setLock(locker)).toThrow(/SQLITE_BUSY|database is locked/);
      writer.exec("COMMIT");
      expect(() => setLock(locker)).not.toThrow();
    } finally {
      writer.close();
      locker.close();
    }
    expect(storage.get("in-flight")).not.toBeNull();
    expectCode(() => storage.store("after lock"), "maintenance_locked");
  });

  it("takes the write lock before the operation runs (immediate, not deferred)", () => {
    // Shorten this connection's busy wait so the test does not sit out the 5 s default.
    (storage as unknown as { db: Database.Database }).db.pragma("busy_timeout = 50");
    const writer = connect();
    try {
      writer.exec("BEGIN IMMEDIATE");
      const operation = vi.fn();
      expect(() => storage.semanticWrite(operation)).toThrow(/SQLITE_BUSY|database is locked/);
      expect(operation).not.toHaveBeenCalled();
      writer.exec("COMMIT");
    } finally {
      writer.close();
    }
  });
});

describe("chain_enabled transitions", () => {
  const HintTarget = RekindleStorage.prototype as unknown as { readChainEnabledHint(this: RekindleStorage): boolean };
  const realHint = HintTarget.readChainEnabledHint;
  const inTransaction = () => (storage as unknown as { db: Database.Database }).db.inTransaction;
  const exceptMeta = (s: Record<string, unknown[]>) =>
    Object.fromEntries(Object.entries(s).filter(([t]) => t !== "provenance_meta"));

  let order: string[];

  beforeEach(() => {
    storage = new RekindleStorage(dbPath);
    process.env[TEST_SEED_ENV] = TEST_SEED;
    order = [];
    mockedPrepare.mockImplementation((options) => {
      order.push(`prepare:inTransaction=${inTransaction()}`);
      return actualKeys.prepareWriteContext(options);
    });
  });

  it("hint 0, then the flag flips, then the lock: one prepare outside the lock, one retry, then a successful chained write", async () => {
    // Phase 4 (amendment A4): the retry now lands on a valid chain seeded for the test key.
    // Test-only baseline fixture: the pre-existing memory gets a nonce and a manifest leaf, and the
    // signed baseline payload binds the Merkle root and manifest hash over those leaves. Phase 4
    // test-fixture convention only, not a settled Phase 5 contract.
    const { MERKLE_SPEC, entryHash, jcs, merkleRoot, sortMerkleLeaves, stateHash } = await import("../../provenance/canonical.js");
    const { signEntryHash } = await import("../../provenance/chain.js");
    const { createHash } = await import("node:crypto");
    const key = actualKeys.keyFromSeed(Buffer.from(TEST_SEED, "hex"));
    const keyId = actualKeys.keyIdOf(key);
    const seedValidChain = (db: Database.Database) => {
      const leaves = (db.prepare(`SELECT * FROM memories`).all() as Record<string, unknown>[]).map((row) => {
        const nonce = createHash("sha256").update(`fixture-nonce:memory:${row.id as string}`).digest();
        db.prepare(`UPDATE memories SET nonce = ? WHERE id = ?`).run(nonce, row.id);
        const live = db.prepare(`SELECT * FROM memories WHERE id = ?`).get(row.id) as Record<string, unknown>;
        return { kind: "memory" as const, target_id: row.id as string, state_hash: stateHash("memory", nonce, live) };
      });
      const ordered = sortMerkleLeaves(leaves);
      ordered.forEach((leaf, ordinal) =>
        db.prepare(`INSERT INTO provenance_baseline_manifest (ordinal, kind, target_id, state_hash) VALUES (?, ?, ?, ?)`).run(
          ordinal, leaf.kind, leaf.target_id, leaf.state_hash,
        ),
      );
      const meta_payload = jcs({
        algorithm: MERKLE_SPEC.algorithm, leaf_format: MERKLE_SPEC.leaf_format, ordering: MERKLE_SPEC.ordering,
        leaf_count: ordered.length, root: merkleRoot(ordered),
        manifest_hash: createHash("sha256").update(jcs(ordered.map((l) => [l.kind, l.target_id, l.state_hash]))).digest("hex"),
        unverified_before: true,
      });
      const fields = {
        seq: 1, store_id: STORE_ID, format_version: 1, audit_kind: "baseline", audit_id: null, target_id: null,
        action: "baseline", state_hash: null, prior_state_hash: null, meta_payload, prev_hash: "0".repeat(64),
        key_id: keyId, created_at: "2026-10-11 00:00:00", client: null, thread_id: null, request_id: null,
        author_identity: null, authorization_reference: null, authorization_verified: 0,
      };
      const hash = entryHash(fields);
      db.prepare(
        `INSERT INTO provenance_chain (seq, store_id, format_version, audit_kind, action, meta_payload, prev_hash,
           entry_hash, key_id, signature, created_at) VALUES (1, ?, 1, 'baseline', 'baseline', ?, ?, ?, ?, ?, ?)`,
      ).run(STORE_ID, meta_payload, fields.prev_hash, hash, keyId, signEntryHash(hash, key), fields.created_at);
      db.prepare(
        `UPDATE provenance_meta SET store_id = ?, format_version = 1, canonical = 0, active_key_id = ?, baseline_seq = 1,
           chain_enabled = 1 WHERE id = 1`,
      ).run(STORE_ID, keyId);
    };
    const preId = storage.store("pre-existing", "context");
    const before = snapshot();
    // The spy performs the real hint read, saves its 0, commits chain_enabled = 1 from another
    // connection, then returns the saved stale value: hint -> flip -> BEGIN IMMEDIATE/re-read.
    const hint = vi.spyOn(HintTarget, "readChainEnabledHint").mockImplementation(function (this: RekindleStorage) {
      const stale = realHint.call(this);
      order.push(`hint:${stale}`);
      withConnection(seedValidChain);
      order.push("flipped");
      return stale;
    });
    const operation = vi.fn(() => storage.store("written after the flip", "context"));

    const id = storage.semanticWrite(operation);

    expect(order).toEqual(["hint:false", "flipped", "prepare:inTransaction=false"]);
    expect(hint).toHaveBeenCalledTimes(1);
    expect(mockedPrepare).toHaveBeenCalledTimes(1);
    expect(mockedPrepare).toHaveBeenCalledWith({ store_id: STORE_ID, canonical: false });
    expect(operation).toHaveBeenCalledTimes(1);
    const after = snapshot();
    expect(after.memories).toHaveLength(before.memories.length + 1);
    const chain = after.provenance_chain as Record<string, unknown>[];
    expect(chain.map((r) => [r.seq, r.action, r.target_id])).toEqual([
      [1, "baseline", null],
      [2, "store", id],
    ]);
    expect(chain[1].prev_hash).toBe(chain[0].entry_hash);
    expect(chain[1].key_id).toBe(keyId);
    // The fixture is a valid baseline: the pre-existing row's leaf matches it, and the payload binds the root.
    const manifest = after.provenance_baseline_manifest as { kind: "memory"; target_id: string; state_hash: string }[];
    const preRow = (after.memories as Record<string, unknown>[]).find((m) => m.id === preId)!;
    expect(manifest.map((l) => [l.kind, l.target_id, l.state_hash])).toEqual([
      ["memory", preId, stateHash("memory", preRow.nonce as Buffer, preRow)],
    ]);
    expect(JSON.parse(chain[0].meta_payload as string)).toMatchObject({
      leaf_count: 1,
      root: merkleRoot(manifest),
      // The payload binds exactly the persisted manifest (snapshot rows are in ordinal order).
      manifest_hash: createHash("sha256").update(jcs(manifest.map((l) => [l.kind, l.target_id, l.state_hash]))).digest("hex"),
    });
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("an already-enabled store prepares once per outer call outside the lock (two calls, two prepares), and both chained writes succeed", async () => {
    // Phase 4 (amendment A4): a valid chain seeded for the test key, so both outer calls append.
    // Test-only baseline fixture: the pre-existing memory gets a nonce and a manifest leaf, and the
    // signed baseline payload binds the Merkle root and manifest hash over those leaves. Phase 4
    // test-fixture convention only, not a settled Phase 5 contract.
    const { MERKLE_SPEC, entryHash, jcs, merkleRoot, sortMerkleLeaves, stateHash } = await import("../../provenance/canonical.js");
    const { signEntryHash } = await import("../../provenance/chain.js");
    const { createHash } = await import("node:crypto");
    const key = actualKeys.keyFromSeed(Buffer.from(TEST_SEED, "hex"));
    const keyId = actualKeys.keyIdOf(key);
    const preId = storage.store("pre-existing", "context");
    withConnection((db) => {
      const leaves = (db.prepare(`SELECT * FROM memories`).all() as Record<string, unknown>[]).map((row) => {
        const nonce = createHash("sha256").update(`fixture-nonce:memory:${row.id as string}`).digest();
        db.prepare(`UPDATE memories SET nonce = ? WHERE id = ?`).run(nonce, row.id);
        const live = db.prepare(`SELECT * FROM memories WHERE id = ?`).get(row.id) as Record<string, unknown>;
        return { kind: "memory" as const, target_id: row.id as string, state_hash: stateHash("memory", nonce, live) };
      });
      const ordered = sortMerkleLeaves(leaves);
      ordered.forEach((leaf, ordinal) =>
        db.prepare(`INSERT INTO provenance_baseline_manifest (ordinal, kind, target_id, state_hash) VALUES (?, ?, ?, ?)`).run(
          ordinal, leaf.kind, leaf.target_id, leaf.state_hash,
        ),
      );
      const meta_payload = jcs({
        algorithm: MERKLE_SPEC.algorithm, leaf_format: MERKLE_SPEC.leaf_format, ordering: MERKLE_SPEC.ordering,
        leaf_count: ordered.length, root: merkleRoot(ordered),
        manifest_hash: createHash("sha256").update(jcs(ordered.map((l) => [l.kind, l.target_id, l.state_hash]))).digest("hex"),
        unverified_before: true,
      });
      const fields = {
        seq: 1, store_id: STORE_ID, format_version: 1, audit_kind: "baseline", audit_id: null, target_id: null,
        action: "baseline", state_hash: null, prior_state_hash: null, meta_payload, prev_hash: "0".repeat(64),
        key_id: keyId, created_at: "2026-10-11 00:00:00", client: null, thread_id: null, request_id: null,
        author_identity: null, authorization_reference: null, authorization_verified: 0,
      };
      const hash = entryHash(fields);
      db.prepare(
        `INSERT INTO provenance_chain (seq, store_id, format_version, audit_kind, action, meta_payload, prev_hash,
           entry_hash, key_id, signature, created_at) VALUES (1, ?, 1, 'baseline', 'baseline', ?, ?, ?, ?, ?, ?)`,
      ).run(STORE_ID, meta_payload, fields.prev_hash, hash, keyId, signEntryHash(hash, key), fields.created_at);
      db.prepare(
        `UPDATE provenance_meta SET store_id = ?, format_version = 1, canonical = 0, active_key_id = ?, baseline_seq = 1,
           chain_enabled = 1 WHERE id = 1`,
      ).run(STORE_ID, keyId);
    });
    const operation = vi.fn(() => storage.store("first outer call", "context"));

    storage.semanticWrite(operation);
    storage.store("second outer call", "context");

    expect(order).toEqual(["prepare:inTransaction=false", "prepare:inTransaction=false"]);
    expect(operation).toHaveBeenCalledTimes(1);
    const chain = snapshot().provenance_chain as Record<string, unknown>[];
    expect(chain.map((r) => [r.seq, r.action])).toEqual([
      [1, "baseline"],
      [2, "store"],
      [3, "store"],
    ]);
    expect(chain[2].prev_hash).toBe(chain[1].entry_hash);
    // The fixture is a valid baseline: the pre-existing row's leaf matches it, and the payload binds the root.
    const after = snapshot();
    const manifest = after.provenance_baseline_manifest as { kind: "memory"; target_id: string; state_hash: string }[];
    const preRow = (after.memories as Record<string, unknown>[]).find((m) => m.id === preId)!;
    expect(manifest.map((l) => [l.kind, l.target_id, l.state_hash])).toEqual([
      ["memory", preId, stateHash("memory", preRow.nonce as Buffer, preRow)],
    ]);
    expect(JSON.parse(chain[0].meta_payload as string)).toMatchObject({
      leaf_count: 1,
      root: merkleRoot(manifest),
      // The payload binds exactly the persisted manifest (snapshot rows are in ordinal order).
      manifest_hash: createHash("sha256").update(jcs(manifest.map((l) => [l.kind, l.target_id, l.state_hash]))).digest("hex"),
    });
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("an enabled hint on an unprepared store fails before the lock, without preparing", () => {
    const before = snapshot();
    vi.spyOn(HintTarget, "readChainEnabledHint").mockReturnValue(true);
    const operation = vi.fn();

    expectCode(() => storage.semanticWrite(operation), "store_unprepared");

    expect(mockedPrepare).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it("a missing test seed on an enabled noncanonical store fails closed before the lock", () => {
    withConnection(enableChain);
    delete process.env[TEST_SEED_ENV];
    const before = snapshot();
    expect(() => storage.store("blocked")).toThrow(/REKINDLE_TEST_SIGNING_SEED/);
    expect(snapshot()).toEqual(before);
  });
});

describe("errors thrown by the operation", () => {
  beforeEach(() => {
    storage = new RekindleStorage(dbPath);
    process.env[TEST_SEED_ENV] = TEST_SEED;
  });

  function throwsOriginal(run: () => unknown, original: Error): void {
    let caught: unknown;
    try {
      run();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(original);
  }

  it("an exported reprepare_required thrown by fn propagates unchanged, with no retry or prepare (prepared store)", () => {
    withConnection((db) =>
      db.prepare(`UPDATE provenance_meta SET store_id = ?, format_version = 1, canonical = 0 WHERE id = 1`).run(STORE_ID),
    );
    const before = snapshot();
    const original = new ProvenanceWriteError("reprepare_required", "thrown by the operation");
    const operation = vi.fn(() => {
      storage.store("must roll back");
      throw original;
    });

    throwsOriginal(() => storage.semanticWrite(operation), original);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(mockedPrepare).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it("on an unprepared store, fn's reprepare_required is not replaced by store_unprepared", () => {
    const before = snapshot();
    const original = new ProvenanceWriteError("reprepare_required", "thrown by the operation");
    const operation = vi.fn(() => {
      throw original;
    });

    throwsOriginal(() => storage.semanticWrite(operation), original);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(mockedPrepare).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it("a reprepare_required thrown inside a nested semantic write propagates unchanged through the outer one", () => {
    const before = snapshot();
    const original = new ProvenanceWriteError("reprepare_required", "thrown by the inner operation");
    const inner = vi.fn(() => {
      throw original;
    });
    const outer = vi.fn(() => {
      storage.store("must roll back");
      storage.semanticWrite(inner);
    });

    throwsOriginal(() => storage.semanticWrite(outer), original);

    expect(outer).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(mockedPrepare).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });
});

describe("nesting", () => {
  beforeEach(() => {
    storage = new RekindleStorage(dbPath);
  });

  it("refuses a semantic write inside a non-semantic transaction, with no rows written", () => {
    const before = snapshot();
    expectCode(() => storage.transaction(() => storage.store("inside a deferred transaction")), "unsafe_nesting");
    expect(snapshot()).toEqual(before);
  });

  it("a semantic batch commits together and rolls back together", () => {
    storage.semanticWrite(() => {
      storage.store("first");
      storage.createSession({ summary: "second" });
    });
    expect(storage.list().map((m) => m.content)).toEqual(["first"]);
    expect(storage.sessionCount()).toBe(1);

    const before = snapshot();
    expect(() =>
      storage.semanticWrite(() => {
        storage.store("rolled back");
        throw new Error("abort batch");
      }),
    ).toThrow("abort batch");
    expect(snapshot()).toEqual(before);
  });

  it("nested semantic writes are savepoints that reuse the outer checks", () => {
    const HintTarget = RekindleStorage.prototype as unknown as { readChainEnabledHint(): boolean };
    const hint = vi.spyOn(HintTarget, "readChainEnabledHint");
    storage.semanticWrite(() => {
      storage.store("outer kept");
      try {
        storage.semanticWrite(() => {
          storage.store("inner rolled back");
          throw new Error("inner failure");
        });
      } catch {
        // The inner savepoint rolls back; the outer batch continues.
      }
      storage.store("outer also kept");
    });
    expect(storage.list().map((m) => m.content).sort()).toEqual(["outer also kept", "outer kept"]);
    expect(hint).toHaveBeenCalledTimes(1);
  });
});
