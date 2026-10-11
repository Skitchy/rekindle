import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { prepareWriteContext, type WriteContext } from "../provenance/keys.js";
import { stateHash } from "../provenance/canonical.js";
import { buildChainRow, type AuditProvenance, type ChainHead } from "../provenance/chain.js";

export interface Memory {
  id: string;
  content: string;
  category: string;
  importance: number;
  project: string | null;
  type: string;
  source: string;
  session_id: string | null;
  created_at: string;
  updated_at: string;
  retrieval_count: number;
  last_accessed: string | null;
  writer_client: string | null;
  writer_thread_id: string | null;
  request_id: string | null;
  author_identity: string | null;
  authorization_reference: string | null;
  authorization_verified: number;
}

export interface WriteProvenance {
  client: string;
  thread_id: string;
  request_id: string;
  author_identity: string;
  authorization_reference: string;
}

export interface Session {
  id: string;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  transcript_path: string | null;
  project: string | null;
  checkpoint_memory_id: string | null;
  gap_count: number;
  orientation_score: number | null;
}

export interface SearchResult extends Memory {
  rank: number;
}

export interface MemoryStats {
  total: number;
  byCategory: Record<string, number>;
  byProject: Record<string, number>;
  recentCount: number;
}

const VALID_CATEGORIES = [
  "preference",
  "lesson",
  "context",
  "relationship",
  "general",
] as const;
export type MemoryCategory = (typeof VALID_CATEGORIES)[number];

function generateId(): string {
  return randomBytes(16).toString("hex");
}

export type ProvenanceWriteErrorCode =
  | "maintenance_locked"
  | "reprepare_required"
  | "store_unprepared"
  | "unsafe_nesting"
  | "unchained_edit"
  | "baseline_invalid"
  | "chain_head_missing"
  | "chain_head_invalid";

export class ProvenanceWriteError extends Error {
  readonly code: ProvenanceWriteErrorCode;

  constructor(code: ProvenanceWriteErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "ProvenanceWriteError";
    this.code = code;
  }
}

const LOWER_HEX = (column: string, length: number) =>
  `(typeof(${column}) = 'text' AND length(${column}) = ${length} AND ${column} NOT GLOB '*[^0-9a-f]*')`;

// Provenance schema (plan phase 3). Inert until a baseline enables the chain: nothing in this
// phase writes chain or manifest rows or generates nonces. Design: docs/provenance-chain-design.md.
const PROVENANCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS provenance_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    store_id TEXT CHECK (store_id IS NULL OR ${LOWER_HEX("store_id", 32)}),
    format_version INTEGER CHECK (format_version IS NULL OR (typeof(format_version) = 'integer' AND format_version = 1)),
    canonical INTEGER CHECK (canonical IS NULL OR (typeof(canonical) = 'integer' AND canonical IN (0, 1))),
    active_key_id TEXT CHECK (active_key_id IS NULL OR ${LOWER_HEX("active_key_id", 64)}),
    chain_enabled INTEGER NOT NULL DEFAULT 0 CHECK (typeof(chain_enabled) = 'integer' AND chain_enabled IN (0, 1)),
    baseline_seq INTEGER CHECK (baseline_seq IS NULL OR typeof(baseline_seq) = 'integer'),
    maintenance_lock_token TEXT CHECK (maintenance_lock_token IS NULL OR typeof(maintenance_lock_token) = 'text'),
    maintenance_lock_started_at TEXT CHECK (maintenance_lock_started_at IS NULL OR typeof(maintenance_lock_started_at) = 'text'),
    CHECK ((maintenance_lock_token IS NULL) = (maintenance_lock_started_at IS NULL)),
    CHECK (chain_enabled = 0 OR (store_id IS NOT NULL AND format_version IS NOT NULL AND canonical IS NOT NULL
        AND active_key_id IS NOT NULL AND baseline_seq IS NOT NULL))
);

INSERT OR IGNORE INTO provenance_meta (id) VALUES (1);

CREATE TABLE IF NOT EXISTS provenance_chain (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id TEXT NOT NULL,
    format_version INTEGER NOT NULL CHECK (format_version = 1),
    audit_kind TEXT NOT NULL CHECK (audit_kind IN ('memory', 'session', 'baseline', 'key_rotate')),
    audit_id TEXT,
    target_id TEXT,
    action TEXT NOT NULL,
    state_hash TEXT,
    prior_state_hash TEXT,
    meta_payload TEXT,
    prev_hash TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    key_id TEXT NOT NULL,
    signature TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (
        (audit_kind = 'memory' AND action IN ('store', 'update') AND audit_id IS NOT NULL AND target_id IS NOT NULL
            AND state_hash IS NOT NULL AND prior_state_hash IS NULL AND meta_payload IS NULL)
        OR (audit_kind = 'memory' AND action = 'delete' AND audit_id IS NOT NULL AND target_id IS NOT NULL
            AND state_hash IS NULL AND prior_state_hash IS NOT NULL AND meta_payload IS NULL)
        OR (audit_kind = 'session' AND action IN ('create', 'update') AND audit_id IS NOT NULL AND target_id IS NOT NULL
            AND state_hash IS NOT NULL AND prior_state_hash IS NULL AND meta_payload IS NULL)
        OR (audit_kind IN ('baseline', 'key_rotate') AND action = audit_kind AND audit_id IS NULL AND target_id IS NULL
            AND state_hash IS NULL AND prior_state_hash IS NULL AND meta_payload IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS provenance_baseline_manifest (
    ordinal INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('memory', 'session')),
    target_id TEXT NOT NULL,
    state_hash TEXT NOT NULL CHECK (${LOWER_HEX("state_hash", 64)}),
    UNIQUE (kind, target_id)
);
`;

// Internal signal that the chain was enabled after the hint was read. Thrown only by the check
// before the operation runs and caught only by semanticWrite, so nothing an operation throws
// (including an exported reprepare_required error) can trigger the retry.
class ReprepareSignal extends Error {}

const NONCE_CHECK = "CHECK (nonce IS NULL OR (typeof(nonce) = 'blob' AND length(nonce) = 32))";

interface ProvenanceMeta {
  store_id: string | null;
  format_version: number | null;
  canonical: number | null;
  active_key_id: string | null;
  chain_enabled: number;
  baseline_seq: number | null;
  maintenance_lock_token: string | null;
}

// Set for the duration of a chained batch (plan phase 4): the verified context and store identity.
interface ChainedBatch {
  context: WriteContext;
  store_id: string;
  format_version: number;
}

type StateKind = "memory" | "session";

function eventTimestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

const SCHEMA = `
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

export class RekindleStorage {
  private db: Database.Database;

  constructor(
    dbPath: string,
    private requireWriteProvenance: boolean = process.env.REKINDLE_REQUIRE_WRITE_PROVENANCE === "1"
  ) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
    this.migrateSchema();
  }

  private migrateSchema(): void {
    const migrations = [
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
      `ALTER TABLE memories ADD COLUMN nonce BLOB ${NONCE_CHECK}`,
      `ALTER TABLE sessions ADD COLUMN nonce BLOB ${NONCE_CHECK}`,
    ];

    for (const sql of migrations) {
      try {
        this.db.exec(sql);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("duplicate column name")) {
          throw e;
        }
      }
    }
    this.db.exec(PROVENANCE_SCHEMA);
  }

  private checkedProvenance(provenance?: WriteProvenance): WriteProvenance | undefined {
    if (provenance) {
      for (const [key, value] of Object.entries(provenance)) {
        if (typeof value !== "string" || value.trim().length === 0) throw new Error(`write provenance ${key} is required`);
      }
      return provenance;
    }
    if (this.requireWriteProvenance) {
      throw new Error("write provenance is required by this Rekindle profile");
    }
    return undefined;
  }

  validateWriteProvenance(provenance?: WriteProvenance): WriteProvenance | undefined {
    return this.checkedProvenance(provenance);
  }

  transaction<T>(operation: () => T): T {
    return this.db.transaction(operation)();
  }

  private semanticDepth = 0;

  // Every semantic write (store, update, delete, createSession, updateSession, end_session's batch)
  // runs through here. Search's retrieval_count/last_accessed update is operational and does not.
  // Plan phase 3: hint outside the lock, prepare outside the lock, then an immediate transaction
  // that refuses under maintenance and re-reads chain_enabled before the operation runs.
  semanticWrite<T>(operation: () => T): T {
    // Nested inside a semantic write: a savepoint that reuses the outer checks and context.
    if (this.semanticDepth > 0) return this.db.transaction(operation)();
    // Inside any other transaction, better-sqlite3 would run .immediate() as a savepoint and
    // never take the write lock, so refuse instead.
    if (this.db.inTransaction) {
      throw new ProvenanceWriteError("unsafe_nesting", "semantic writes cannot run inside a non-semantic transaction");
    }
    const context = this.readChainEnabledHint() ? this.prepareContext() : null;
    try {
      return this.lockedSemanticWrite(operation, context);
    } catch (e: unknown) {
      if (!(e instanceof ReprepareSignal)) throw e;
    }
    // The chain was enabled after the hint was read: prepare outside the lock and retry once.
    try {
      return this.lockedSemanticWrite(operation, this.prepareContext());
    } catch (e: unknown) {
      if (e instanceof ReprepareSignal) {
        throw new ProvenanceWriteError("reprepare_required", "the chain was enabled after the write was prepared");
      }
      throw e;
    }
  }

  private readChainEnabledHint(): boolean {
    return this.readMeta().chain_enabled === 1;
  }

  private readMeta(): ProvenanceMeta {
    return this.db
      .prepare(
        `SELECT store_id, format_version, canonical, active_key_id, chain_enabled, baseline_seq, maintenance_lock_token
         FROM provenance_meta WHERE id = 1`
      )
      .get() as ProvenanceMeta;
  }

  private prepareContext(): WriteContext {
    const meta = this.readMeta();
    if (meta.store_id === null || meta.canonical === null) {
      throw new ProvenanceWriteError("store_unprepared", "provenance is not prepared for this store");
    }
    return prepareWriteContext({ store_id: meta.store_id, canonical: meta.canonical === 1 });
  }

  private lockedSemanticWrite<T>(operation: () => T, context: WriteContext | null): T {
    const run = this.db.transaction(() => {
      const meta = this.readMeta();
      if (meta.maintenance_lock_token !== null) {
        throw new ProvenanceWriteError("maintenance_locked", "the store is under maintenance; semantic writes are refused");
      }
      if (meta.chain_enabled === 1) {
        // A context prepared for another store or key is stale: re-prepare outside the lock.
        if (context === null || context.store_id !== meta.store_id || context.key_id !== meta.active_key_id) {
          throw new ReprepareSignal();
        }
        this.checkChainHead(meta);
        this.chained = { context, store_id: context.store_id, format_version: meta.format_version as number };
      }
      this.semanticDepth++;
      try {
        return operation();
      } finally {
        this.semanticDepth--;
        this.chained = null;
      }
    });
    return run.immediate();
  }

  private chained: ChainedBatch | null = null;

  // Once per outer chained batch, under the lock, before the operation runs.
  private checkChainHead(meta: ProvenanceMeta): void {
    const head = this.db
      .prepare(`SELECT seq, store_id, format_version FROM provenance_chain ORDER BY seq DESC LIMIT 1`)
      .get() as { seq: number; store_id: string; format_version: number } | undefined;
    if (!head) throw new ProvenanceWriteError("chain_head_missing", "the chain is enabled but has no entries");
    if (head.store_id !== meta.store_id || head.format_version !== meta.format_version) {
      throw new ProvenanceWriteError("chain_head_invalid", "the chain head belongs to another store or format");
    }
    // Every chain insert leaves sqlite_sequence equal to MAX(seq); anything else means rows were removed.
    const sequence = this.db
      .prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'provenance_chain'`)
      .get() as { seq: number } | undefined;
    if (!sequence || sequence.seq !== head.seq) {
      throw new ProvenanceWriteError("chain_head_invalid", "the chain sequence does not match its head");
    }
    const baseline = this.db
      .prepare(`SELECT audit_kind, store_id, format_version FROM provenance_chain WHERE seq = ?`)
      .get(meta.baseline_seq) as { audit_kind: string; store_id: string; format_version: number } | undefined;
    if (
      !baseline ||
      baseline.audit_kind !== "baseline" ||
      baseline.store_id !== meta.store_id ||
      baseline.format_version !== meta.format_version
    ) {
      throw new ProvenanceWriteError("baseline_invalid", "baseline_seq does not identify this store's baseline entry");
    }
  }

  // The current head inside the batch: re-read each time, so a rolled-back savepoint never leaves
  // a stale in-memory head behind.
  private chainHead(): ChainHead {
    return this.db
      .prepare(`SELECT seq, entry_hash FROM provenance_chain ORDER BY seq DESC LIMIT 1`)
      .get() as ChainHead;
  }

  // Latest chained state of a target: its newest event entry for this store and format, else its
  // baseline manifest leaf. undefined means never chained; a latest delete means absent.
  private latestChainedState(kind: StateKind, targetId: string): { present: boolean; state_hash: string | null } | undefined {
    const batch = this.chained as ChainedBatch;
    const entry = this.db
      .prepare(
        `SELECT action, state_hash FROM provenance_chain
         WHERE store_id = ? AND format_version = ? AND audit_kind = ? AND target_id = ?
         ORDER BY seq DESC LIMIT 1`
      )
      .get(batch.store_id, batch.format_version, kind, targetId) as { action: string; state_hash: string | null } | undefined;
    if (entry) return entry.action === "delete" ? { present: false, state_hash: null } : { present: true, state_hash: entry.state_hash };
    const leaf = this.db
      .prepare(`SELECT state_hash FROM provenance_baseline_manifest WHERE kind = ? AND target_id = ?`)
      .get(kind, targetId) as { state_hash: string } | undefined;
    return leaf ? { present: true, state_hash: leaf.state_hash } : undefined;
  }

  // Pre-state check for update and delete, before any mutation. Returns null when the row is
  // absent and the chain agrees, so callers keep their existing false/no-audit behavior.
  private verifiedPreState(kind: StateKind, targetId: string): { row: Record<string, unknown>; state_hash: string } | null {
    const table = kind === "memory" ? "memories" : "sessions";
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(targetId) as Record<string, unknown> | undefined;
    const latest = this.latestChainedState(kind, targetId);
    if (!row) {
      if (latest?.present) throw new ProvenanceWriteError("unchained_edit", `${kind} ${targetId} is missing but the chain says it exists`);
      return null;
    }
    if (!latest?.present) throw new ProvenanceWriteError("unchained_edit", `${kind} ${targetId} has no chained state`);
    const nonce = row.nonce;
    if (!(nonce instanceof Uint8Array) || nonce.length !== 32) {
      throw new ProvenanceWriteError("unchained_edit", `${kind} ${targetId} has no valid nonce`);
    }
    const current = stateHash(kind, nonce, row);
    if (current !== latest.state_hash) {
      throw new ProvenanceWriteError("unchained_edit", `${kind} ${targetId} was changed outside the chain`);
    }
    return { row, state_hash: current };
  }

  private currentStateHash(kind: StateKind, targetId: string): string {
    const table = kind === "memory" ? "memories" : "sessions";
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(targetId) as Record<string, unknown>;
    return stateHash(kind, row.nonce as Uint8Array, row);
  }

  private appendChain(event: {
    kind: StateKind;
    auditId: string;
    targetId: string;
    action: "store" | "update" | "delete" | "create";
    state_hash: string | null;
    prior_state_hash: string | null;
    eventAt: string;
  }): void {
    const batch = this.chained as ChainedBatch;
    const auditTable = event.kind === "memory" ? "memory_write_audit" : "session_write_audit";
    // Bind the provenance exactly as stored in the audit row.
    const provenance = this.db
      .prepare(
        `SELECT client, thread_id, request_id, author_identity, authorization_reference, authorization_verified
         FROM ${auditTable} WHERE id = ?`
      )
      .get(event.auditId) as AuditProvenance;
    const row = buildChainRow({
      head: this.chainHead(),
      store_id: batch.store_id,
      key: batch.context.key,
      key_id: batch.context.key_id,
      audit_kind: event.kind,
      audit_id: event.auditId,
      target_id: event.targetId,
      action: event.action,
      state_hash: event.state_hash,
      prior_state_hash: event.prior_state_hash,
      created_at: event.eventAt,
      provenance,
    });
    this.db
      .prepare(
        `INSERT INTO provenance_chain (seq, store_id, format_version, audit_kind, audit_id, target_id, action,
           state_hash, prior_state_hash, meta_payload, prev_hash, entry_hash, key_id, signature, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.seq, row.store_id, row.format_version, row.audit_kind, row.audit_id, row.target_id, row.action,
        row.state_hash, row.prior_state_hash, row.meta_payload, row.prev_hash, row.entry_hash, row.key_id,
        row.signature, row.created_at
      );
  }

  // createdAt is passed only on the chained path (event_at); otherwise the DB default applies as before.
  private auditWrite(
    memoryId: string,
    action: "store" | "update" | "delete",
    provenance?: WriteProvenance,
    createdAt?: string
  ): string {
    const id = generateId();
    const params = [id, memoryId, action, provenance?.client ?? null, provenance?.thread_id ?? null,
      provenance?.request_id ?? null, provenance?.author_identity ?? null,
      provenance?.authorization_reference ?? null];
    if (createdAt === undefined) {
      this.db.prepare(`
        INSERT INTO memory_write_audit
          (id, memory_id, action, client, thread_id, request_id, author_identity, authorization_reference, authorization_verified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(...params);
    } else {
      this.db.prepare(`
        INSERT INTO memory_write_audit
          (id, memory_id, action, client, thread_id, request_id, author_identity, authorization_reference, authorization_verified, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).run(...params, createdAt);
    }
    return id;
  }

  private auditSession(
    sessionId: string,
    action: "create" | "update",
    provenance?: WriteProvenance,
    createdAt?: string
  ): string {
    const id = generateId();
    const params = [id, sessionId, action, provenance?.client ?? null, provenance?.thread_id ?? null,
      provenance?.request_id ?? null, provenance?.author_identity ?? null,
      provenance?.authorization_reference ?? null];
    if (createdAt === undefined) {
      this.db.prepare(`
        INSERT INTO session_write_audit
          (id, session_id, action, client, thread_id, request_id, author_identity, authorization_reference, authorization_verified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(...params);
    } else {
      this.db.prepare(`
        INSERT INTO session_write_audit
          (id, session_id, action, client, thread_id, request_id, author_identity, authorization_reference, authorization_verified, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).run(...params, createdAt);
    }
    return id;
  }

  store(
    content: string,
    category: MemoryCategory = "general",
    importance: number = 5,
    project?: string,
    opts?: { type?: string; source?: string; session_id?: string; provenance?: WriteProvenance }
  ): string {
    const provenance = this.checkedProvenance(opts?.provenance);
    const id = generateId();
    const stmt = this.db.prepare(`
      INSERT INTO memories (id, content, category, importance, project, type, source, session_id,
        writer_client, writer_thread_id, request_id, author_identity, authorization_reference, authorization_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);
    const values = [
      id, content, category, Math.max(1, Math.min(10, importance)), project ?? null,
      opts?.type ?? "memory", opts?.source ?? "manual", opts?.session_id ?? null,
      provenance?.client ?? null, provenance?.thread_id ?? null, provenance?.request_id ?? null,
      provenance?.author_identity ?? null, provenance?.authorization_reference ?? null,
    ];
    this.semanticWrite(() => {
      if (!this.chained) {
        stmt.run(...values);
        this.auditWrite(id, "store", provenance);
        return;
      }
      const eventAt = eventTimestamp();
      this.db.prepare(`
        INSERT INTO memories (id, content, category, importance, project, type, source, session_id,
          writer_client, writer_thread_id, request_id, author_identity, authorization_reference, authorization_verified,
          created_at, updated_at, nonce)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      `).run(...values, eventAt, eventAt, randomBytes(32));
      const auditId = this.auditWrite(id, "store", provenance, eventAt);
      this.appendChain({
        kind: "memory", auditId, targetId: id, action: "store",
        state_hash: this.currentStateHash("memory", id), prior_state_hash: null, eventAt,
      });
    });
    return id;
  }

  search(
    query: string,
    opts: { category?: string; project?: string; limit?: number } = {}
  ): SearchResult[] {
    const limit = opts.limit ?? 10;

    let sql = `
      SELECT m.*, bm25(memories_fts) AS fts_rank
      FROM memories_fts fts
      JOIN memories m ON m.rowid = fts.rowid
      WHERE memories_fts MATCH ?
    `;
    const ftsQuery = query
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .map((w) => `"${w.replace(/"/g, '""')}"`)
      .join(" OR ");
    const params: (string | number)[] = [ftsQuery];

    if (opts.category) {
      sql += ` AND m.category = ?`;
      params.push(opts.category);
    }
    if (opts.project) {
      sql += ` AND m.project = ?`;
      params.push(opts.project);
    }

    sql += ` ORDER BY (fts_rank * (m.importance / 10.0)) LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as (Memory & { fts_rank: number })[];

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const updateAccess = this.db.prepare(`
      UPDATE memories SET retrieval_count = retrieval_count + 1, last_accessed = ? WHERE id = ?
    `);
    const updateMany = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        updateAccess.run(now, id);
      }
    });
    updateMany(rows.map((r) => r.id));

    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      category: row.category,
      importance: row.importance,
      project: row.project,
      type: row.type,
      source: row.source,
      session_id: row.session_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      retrieval_count: row.retrieval_count + 1,
      last_accessed: now,
      writer_client: row.writer_client,
      writer_thread_id: row.writer_thread_id,
      request_id: row.request_id,
      author_identity: row.author_identity,
      authorization_reference: row.authorization_reference,
      authorization_verified: row.authorization_verified,
      rank: row.fts_rank,
    }));
  }

  list(
    opts: { category?: string; project?: string; limit?: number } = {}
  ): Memory[] {
    const limit = opts.limit ?? 50;

    let sql = `SELECT * FROM memories WHERE 1=1`;
    const params: (string | number)[] = [];

    if (opts.category) {
      sql += ` AND category = ?`;
      params.push(opts.category);
    }
    if (opts.project) {
      sql += ` AND project = ?`;
      params.push(opts.project);
    }

    sql += ` ORDER BY created_at DESC, rowid DESC LIMIT ?`;
    params.push(limit);

    return this.db.prepare(sql).all(...params) as Memory[];
  }

  get(id: string): Memory | null {
    const row = this.db
      .prepare(`SELECT * FROM memories WHERE id = ?`)
      .get(id) as Memory | undefined;
    return row ?? null;
  }

  update(
    id: string,
    fields: { content?: string; category?: MemoryCategory; importance?: number },
    provenance?: WriteProvenance
  ): boolean {
    const checked = this.checkedProvenance(provenance);
    // The current row is read under the write lock, so the update builds on committed state.
    return this.semanticWrite(() => {
      const eventAt = this.chained ? eventTimestamp() : null;
      // On the chained path, the live row must match its latest chained state before any mutation.
      const existing = this.chained ? (this.verifiedPreState("memory", id)?.row as Memory | undefined) : this.get(id);
      if (!existing) return false;

      const content = fields.content ?? existing.content;
      const category = fields.category ?? existing.category;
      const importance = fields.importance
        ? Math.max(1, Math.min(10, fields.importance))
        : existing.importance;
      const now = eventAt ?? new Date().toISOString().replace("T", " ").slice(0, 19);

      this.db.prepare(
        `UPDATE memories SET content = ?, category = ?, importance = ?, updated_at = ? WHERE id = ?`
      ).run(content, category, importance, now, id);
      if (eventAt === null) {
        this.auditWrite(id, "update", checked);
        return true;
      }
      const auditId = this.auditWrite(id, "update", checked, eventAt);
      this.appendChain({
        kind: "memory", auditId, targetId: id, action: "update",
        state_hash: this.currentStateHash("memory", id), prior_state_hash: null, eventAt,
      });
      return true;
    });
  }

  delete(id: string, provenance?: WriteProvenance): boolean {
    const checked = this.checkedProvenance(provenance);
    return this.semanticWrite(() => {
      if (!this.chained) {
        const result = this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
        if (result.changes > 0) this.auditWrite(id, "delete", checked);
        return result.changes > 0;
      }
      const eventAt = eventTimestamp();
      const pre = this.verifiedPreState("memory", id);
      if (!pre) return false;
      this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
      const auditId = this.auditWrite(id, "delete", checked, eventAt);
      this.appendChain({
        kind: "memory", auditId, targetId: id, action: "delete",
        state_hash: null, prior_state_hash: pre.state_hash, eventAt,
      });
      return true;
    });
  }

  listWriteAudit(memoryId?: string): Array<Record<string, unknown>> {
    if (memoryId) return this.db.prepare(`SELECT * FROM memory_write_audit WHERE memory_id = ? ORDER BY created_at, rowid`).all(memoryId) as Array<Record<string, unknown>>;
    return this.db.prepare(`SELECT * FROM memory_write_audit ORDER BY created_at, rowid`).all() as Array<Record<string, unknown>>;
  }

  stats(project?: string): MemoryStats {
    const where = project ? ` WHERE project = ?` : "";
    const params = project ? [project] : [];
    const total = (
      this.db.prepare(`SELECT COUNT(*) as count FROM memories${where}`).get(...params) as {
        count: number;
      }
    ).count;

    const catRows = this.db
      .prepare(
        `SELECT category, COUNT(*) as count FROM memories${where} GROUP BY category`
      )
      .all(...params) as { category: string; count: number }[];
    const byCategory: Record<string, number> = {};
    for (const row of catRows) {
      byCategory[row.category] = row.count;
    }

    const projRows = this.db
      .prepare(
        `SELECT COALESCE(project, '(none)') as project, COUNT(*) as count FROM memories${where} GROUP BY project`
      )
      .all(...params) as { project: string; count: number }[];
    const byProject: Record<string, number> = {};
    for (const row of projRows) {
      byProject[row.project] = row.count;
    }

    const recentCount = (
      this.db
        .prepare(
          `SELECT COUNT(*) as count FROM memories WHERE created_at > datetime('now', '-7 days')${project ? " AND project = ?" : ""}`
        )
        .get(...params) as { count: number }
    ).count;

    return { total, byCategory, byProject, recentCount };
  }

  getLatestCheckpoint(
    project?: string,
    options: { fallbackToContext?: boolean } = {}
  ): Memory | null {
    let sql = `SELECT * FROM memories WHERE type = 'checkpoint'`;
    const params: string[] = [];

    if (project) {
      sql += ` AND project = ?`;
      params.push(project);
    }

    sql += ` ORDER BY created_at DESC, rowid DESC LIMIT 1`;

    let row = this.db.prepare(sql).get(...params) as Memory | undefined;
    if (!row && (options.fallbackToContext ?? true)) {
      let fallback = `SELECT * FROM memories WHERE category = 'context' AND type = 'memory'`;
      const fbParams: string[] = [];
      if (project) {
        fallback += ` AND project = ?`;
        fbParams.push(project);
      }
      fallback += ` ORDER BY created_at DESC, rowid DESC LIMIT 1`;
      row = this.db.prepare(fallback).get(...fbParams) as Memory | undefined;
    }
    return row ?? null;
  }

  createSession(data: {
    summary: string;
    transcriptPath?: string;
    project?: string;
    checkpointMemoryId?: string;
    gapCount?: number;
    orientationScore?: number;
  }, provenance?: WriteProvenance): string {
    const checked = this.checkedProvenance(provenance);
    const id = generateId();
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    this.semanticWrite(() => {
      // The chained path takes one event_at inside the lock for both timestamps, plus a fresh nonce.
      const eventAt = this.chained ? eventTimestamp() : null;
      const at = eventAt ?? now;
      this.db
        .prepare(
          `INSERT INTO sessions (id, started_at, ended_at, summary, transcript_path, project, checkpoint_memory_id, gap_count, orientation_score, nonce)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          at,
          at,
          data.summary,
          data.transcriptPath ?? null,
          data.project ?? null,
          data.checkpointMemoryId ?? null,
          data.gapCount ?? 0,
          data.orientationScore ?? null,
          eventAt === null ? null : randomBytes(32)
        );
      if (eventAt === null) {
        this.auditSession(id, "create", checked);
        return;
      }
      const auditId = this.auditSession(id, "create", checked, eventAt);
      this.appendChain({
        kind: "session", auditId, targetId: id, action: "create",
        state_hash: this.currentStateHash("session", id), prior_state_hash: null, eventAt,
      });
    });
    return id;
  }

  updateSession(
    id: string,
    data: { summary?: string; checkpointMemoryId?: string; gapCount?: number; orientationScore?: number },
    provenance?: WriteProvenance
  ): boolean {
    const checked = this.checkedProvenance(provenance);
    return this.semanticWrite(() => {
      // Session updates set no domain timestamp; event_at goes to the audit and chain rows only.
      const eventAt = this.chained ? eventTimestamp() : null;
      const existing = this.chained ? (this.verifiedPreState("session", id)?.row as Session | undefined) : this.getSession(id);
      if (!existing) return false;

      this.db
        .prepare(
          `UPDATE sessions SET summary = ?, checkpoint_memory_id = ?, gap_count = ?, orientation_score = ? WHERE id = ?`
        )
        .run(
          data.summary ?? existing.summary,
          data.checkpointMemoryId ?? existing.checkpoint_memory_id,
          data.gapCount ?? existing.gap_count,
          data.orientationScore ?? existing.orientation_score,
          id
        );
      if (eventAt === null) {
        this.auditSession(id, "update", checked);
        return true;
      }
      const auditId = this.auditSession(id, "update", checked, eventAt);
      this.appendChain({
        kind: "session", auditId, targetId: id, action: "update",
        state_hash: this.currentStateHash("session", id), prior_state_hash: null, eventAt,
      });
      return true;
    });
  }

  getSession(id: string): Session | null {
    const row = this.db
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(id) as Session | undefined;
    return row ?? null;
  }

  listSessionWriteAudit(sessionId?: string): Array<Record<string, unknown>> {
    if (sessionId) return this.db.prepare(`SELECT * FROM session_write_audit WHERE session_id = ? ORDER BY created_at, rowid`).all(sessionId) as Array<Record<string, unknown>>;
    return this.db.prepare(`SELECT * FROM session_write_audit ORDER BY created_at, rowid`).all() as Array<Record<string, unknown>>;
  }

  sessionCount(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS count FROM sessions`).get() as { count: number }).count;
  }

  close(): void {
    this.db.close();
  }
}
