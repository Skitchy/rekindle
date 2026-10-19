import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RekindleStorage } from "../../storage/sqlite.js";
import { computeInventory, diagnosticInventory, INVENTORY_TABLES } from "../inventory.js";

let root: string;

function freshStore(name: string): string {
  const path = join(root, name);
  new RekindleStorage(path).close();
  return path;
}

function inventoryOf(path: string) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return computeInventory(db);
  } finally {
    db.close();
  }
}

function exec(path: string, sql: string, ...params: unknown[]): void {
  const db = new Database(path, { fileMustExist: true });
  try {
    db.prepare(sql).run(...params);
  } finally {
    db.close();
  }
}

const INSERT_MEMORY = `INSERT INTO memories (id, content, category, importance, project, created_at, updated_at)
  VALUES (?, ?, 'lesson', 5, 'p', '2026-10-19 00:00:00', '2026-10-19 00:00:00')`;

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (e: unknown) {
    expect((e as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}, nothing was thrown`);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rekindle-p5-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("inventory (spec 237 G)", () => {
  it("is deterministic, and names every closed-set table", () => {
    const path = freshStore("a.db");
    exec(path, INSERT_MEMORY, "m1", "one");
    const first = inventoryOf(path);
    expect(inventoryOf(path)).toEqual(first);
    const doc = JSON.parse(first.document);
    expect(doc.format).toBe("rekindle-inventory-v1");
    expect(Object.keys(doc.tables).sort()).toEqual(INVENTORY_TABLES.map((t) => t.name).sort());
    expect(doc.tables.memories.count).toBe(1);
    expect(doc.asserts).toEqual({ provenance_chain_empty: true, manifest_empty: true });
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is equal across an online backup and a VACUUM INTO copy (rootpage and rowid are not inputs)", async () => {
    const path = freshStore("a.db");
    for (let i = 0; i < 50; i++) exec(path, INSERT_MEMORY, `m${String(i).padStart(2, "0")}`, "x".repeat(500));
    exec(path, `DELETE FROM memories WHERE id < 'm25'`);
    const live = new Database(path);
    await live.backup(join(root, "backup.db"));
    live.exec(`VACUUM INTO '${join(root, "vacuum.db")}'`);
    live.close();
    const original = inventoryOf(path);
    expect(inventoryOf(join(root, "backup.db")).document).toBe(original.document);
    expect(inventoryOf(join(root, "vacuum.db")).document).toBe(original.document);
  });

  it("does not depend on insertion order", () => {
    const a = freshStore("a.db");
    const b = freshStore("b.db");
    exec(a, INSERT_MEMORY, "m1", "one");
    exec(a, INSERT_MEMORY, "m2", "two");
    exec(b, INSERT_MEMORY, "m2", "two");
    exec(b, INSERT_MEMORY, "m1", "one");
    expect(inventoryOf(b).document).toBe(inventoryOf(a).document);
  });

  it.each([
    ["memories", `UPDATE memories SET content = 'changed'`],
    ["memories retrieval_count", `UPDATE memories SET retrieval_count = 1`],
    ["sessions", `INSERT INTO sessions (id, summary) VALUES ('s1', 'x')`],
    ["memory_write_audit", `INSERT INTO memory_write_audit (id, memory_id, action) VALUES ('a1', 'm1', 'store')`],
    ["session_write_audit", `INSERT INTO session_write_audit (id, session_id, action) VALUES ('a1', 's1', 'create')`],
    ["provenance_meta", `UPDATE provenance_meta SET store_id = '0123456789abcdef0123456789abcdef'`],
    ["sqlite_sequence", `INSERT INTO sqlite_sequence (name, seq) VALUES ('provenance_chain', 3)`],
    ["schema", `CREATE INDEX extra_idx ON memories (project)`],
  ])("detects a change to %s", (_label, sql) => {
    const path = freshStore("a.db");
    exec(path, INSERT_MEMORY, "m1", "one");
    const before = inventoryOf(path);
    exec(path, sql);
    expect(inventoryOf(path).document).not.toBe(before.document);
  });

  it("distinguishes storage classes that share bytes (TEXT 'abc' vs BLOB X'616263')", () => {
    const a = freshStore("a.db");
    const b = freshStore("b.db");
    exec(a, `INSERT INTO sessions (id, summary, started_at) VALUES ('s1', 'abc', '2026-10-19 00:00:00')`);
    exec(b, `INSERT INTO sessions (id, summary, started_at) VALUES ('s1', X'616263', '2026-10-19 00:00:00')`);
    expect(inventoryOf(b).document).not.toBe(inventoryOf(a).document);
  });

  it("excludes the derived FTS data: a rebuild leaves it unchanged", () => {
    const path = freshStore("a.db");
    exec(path, INSERT_MEMORY, "m1", "one");
    const before = inventoryOf(path);
    exec(path, `INSERT INTO memories_fts(memories_fts) VALUES ('rebuild')`);
    expect(inventoryOf(path).document).toBe(before.document);
  });

  it("refuses a REAL value", () => {
    const path = freshStore("a.db");
    exec(path, INSERT_MEMORY, "m1", "one");
    exec(path, `UPDATE memories SET importance = 5.5`);
    expectCode(() => inventoryOf(path), "inventory_unsupported_value");
  });

  it.each([
    ["provenance_chain", `INSERT INTO provenance_chain (store_id, format_version, audit_kind, action, meta_payload, prev_hash, entry_hash, key_id, signature, created_at)
       VALUES ('s', 1, 'baseline', 'baseline', '{}', 'p', 'e', 'k', 'sig', 'now')`],
    ["provenance_baseline_manifest", `INSERT INTO provenance_baseline_manifest (ordinal, kind, target_id, state_hash) VALUES (0, 'memory', 'm1', '${"0".repeat(64)}')`],
  ])("refuses when %s is not empty", (_label, sql) => {
    const path = freshStore("a.db");
    exec(path, sql);
    expectCode(() => inventoryOf(path), "inventory_not_empty");
  });

  it("diagnosticInventory is byte-equal to computeInventory on a pre-baseline store, and records non-empty asserts instead of refusing", () => {
    const path = freshStore("a.db");
    exec(path, INSERT_MEMORY, "m1", "one");
    const db = new Database(path, { readonly: true });
    try {
      expect(diagnosticInventory(db)).toEqual(computeInventory(db));
    } finally {
      db.close();
    }
    exec(path, `INSERT INTO provenance_baseline_manifest (ordinal, kind, target_id, state_hash) VALUES (0, 'memory', 'm1', '${"0".repeat(64)}')`);
    const after = new Database(path, { readonly: true });
    try {
      expect(JSON.parse(diagnosticInventory(after).document).asserts).toEqual({ provenance_chain_empty: true, manifest_empty: false });
      expectCode(() => computeInventory(after), "inventory_not_empty");
    } finally {
      after.close();
    }
  });

  it("refuses when a closed-set table is missing", () => {
    const path = join(root, "bare.db");
    const db = new Database(path);
    db.exec("CREATE TABLE memories (id TEXT PRIMARY KEY)");
    db.close();
    expectCode(() => inventoryOf(path), "inventory_table_missing");
  });

  it("reads inside one transaction when none is open, and inside the caller's when one is", () => {
    const path = freshStore("a.db");
    const db = new Database(path);
    try {
      expect(db.inTransaction).toBe(false);
      const outside = computeInventory(db);
      expect(db.inTransaction).toBe(false);
      const inside = db.transaction(() => computeInventory(db)).immediate();
      expect(inside).toEqual(outside);
    } finally {
      db.close();
    }
  });
});
