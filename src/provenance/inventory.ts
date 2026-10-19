import type Database from "better-sqlite3";
import { jcs } from "./canonical.js";
import { INVENTORY_FORMAT, INVENTORY_ROW_TAG, INVENTORY_TAG, taggedSha256 } from "./baseline-format.js";

// Logical inventory of a store's pre-baseline state (plan phase 5 step 3, spec room 237 G).
// It is read through SQLite, so committed WAL content is included and the -wal/-shm files are not
// inputs. Two inventories are equal only when their serialized documents are byte-equal.

export type InventoryErrorCode = "inventory_unsupported_value" | "inventory_not_empty" | "inventory_table_missing";

export class InventoryError extends Error {
  readonly code: InventoryErrorCode;

  constructor(code: InventoryErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "InventoryError";
    this.code = code;
  }
}

// The closed set of row-data tables and their ordering key. Every primary key is single-column.
// memories_fts and its shadow tables are derived and excluded as data (they remain in the schema part).
export const INVENTORY_TABLES = [
  { name: "memories", key: "id" },
  { name: "sessions", key: "id" },
  { name: "memory_write_audit", key: "id" },
  { name: "session_write_audit", key: "id" },
  { name: "provenance_meta", key: "id" },
  { name: "provenance_chain", key: "seq" },
  { name: "provenance_baseline_manifest", key: "ordinal" },
  { name: "sqlite_sequence", key: "name" },
] as const;

export interface Inventory {
  document: string;
  hash: string;
}

type Cell = [string, string] | null;

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function tableExists(db: Database.Database, name: string): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !== undefined;
}

function rowHashes(db: Database.Database, table: string, key: string): string[] {
  const columns = (db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as { name: string }[]).map((c) => c.name);
  // Each value is described in SQL as its storage class and the hex of its stored bytes, so no JS
  // decoding (number precision, text encoding, blob handling) can make two different values agree.
  const select = columns
    .map((c, i) => `typeof(${quoteIdent(c)}) AS t${i}, hex(${quoteIdent(c)}) AS h${i}`)
    .join(", ");
  const rows = db
    .prepare(`SELECT ${select} FROM ${quoteIdent(table)} ORDER BY ${quoteIdent(key)} COLLATE BINARY`)
    .all() as Record<string, string>[];
  return rows.map((row) => {
    const cells: Record<string, Cell> = {};
    columns.forEach((column, i) => {
      const type = row[`t${i}`];
      if (type === "real") {
        throw new InventoryError("inventory_unsupported_value", `${table}.${column} holds a REAL value`);
      }
      cells[column] = type === "null" ? null : [type, row[`h${i}`].toLowerCase()];
    });
    return taggedSha256(INVENTORY_ROW_TAG, Buffer.from(jcs(cells), "utf8"));
  });
}

function build(db: Database.Database, enforceEmpty: boolean): Inventory {
  for (const { name } of INVENTORY_TABLES) {
    if (!tableExists(db, name)) throw new InventoryError("inventory_table_missing", `table ${name} is missing`);
  }
  // rootpage is physical and excluded; sql is kept exactly as stored, NULL included.
  const schema = (
    db
      .prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type COLLATE BINARY, name COLLATE BINARY`)
      .all() as { type: string; name: string; tbl_name: string; sql: string | null }[]
  ).map((entry) => [entry.type, entry.name, entry.tbl_name, entry.sql]);
  const tables: Record<string, { count: number; row_hashes: string[] }> = {};
  for (const { name, key } of INVENTORY_TABLES) {
    const row_hashes = rowHashes(db, name, key);
    tables[name] = { count: row_hashes.length, row_hashes };
  }
  const provenance_chain_empty = tables.provenance_chain.count === 0;
  const manifest_empty = tables.provenance_baseline_manifest.count === 0;
  if (enforceEmpty && !provenance_chain_empty) {
    throw new InventoryError("inventory_not_empty", "provenance_chain must be empty before a baseline");
  }
  if (enforceEmpty && !manifest_empty) {
    throw new InventoryError("inventory_not_empty", "provenance_baseline_manifest must be empty before a baseline");
  }
  const document = jcs({
    format: INVENTORY_FORMAT,
    schema,
    tables,
    asserts: { provenance_chain_empty, manifest_empty },
  });
  return { document, hash: taggedSha256(INVENTORY_TAG, Buffer.from(document, "utf8")) };
}

// Every read happens inside one transaction, so the inventory is one consistent snapshot. Inside a
// caller's transaction (the baseline's BEGIN IMMEDIATE) it reads that transaction's view.
export function computeInventory(db: Database.Database): Inventory {
  return db.inTransaction ? build(db, true) : db.transaction(() => build(db, true))();
}

// Diagnostics only (spec 241 (d)): the same document rule, but the empty asserts are recorded as
// observed instead of refusing. On a pre-baseline store it is byte-equal to computeInventory; after a
// baseline it shows that the store no longer matches the baseline's inventory_hash. Never used to
// authorize a baseline.
export function diagnosticInventory(db: Database.Database): Inventory {
  return db.inTransaction ? build(db, false) : db.transaction(() => build(db, false))();
}
