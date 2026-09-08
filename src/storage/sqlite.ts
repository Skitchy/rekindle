import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

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

  private auditWrite(memoryId: string, action: "store" | "update" | "delete", provenance?: WriteProvenance): void {
    this.db.prepare(`
      INSERT INTO memory_write_audit
        (id, memory_id, action, client, thread_id, request_id, author_identity, authorization_reference, authorization_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(generateId(), memoryId, action, provenance?.client ?? null, provenance?.thread_id ?? null,
      provenance?.request_id ?? null, provenance?.author_identity ?? null,
      provenance?.authorization_reference ?? null);
  }

  private auditSession(sessionId: string, action: "create" | "update", provenance?: WriteProvenance): void {
    this.db.prepare(`
      INSERT INTO session_write_audit
        (id, session_id, action, client, thread_id, request_id, author_identity, authorization_reference, authorization_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(generateId(), sessionId, action, provenance?.client ?? null, provenance?.thread_id ?? null,
      provenance?.request_id ?? null, provenance?.author_identity ?? null,
      provenance?.authorization_reference ?? null);
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
    this.transaction(() => {
      stmt.run(
        id, content, category, Math.max(1, Math.min(10, importance)), project ?? null,
        opts?.type ?? "memory", opts?.source ?? "manual", opts?.session_id ?? null,
        provenance?.client ?? null, provenance?.thread_id ?? null, provenance?.request_id ?? null,
        provenance?.author_identity ?? null, provenance?.authorization_reference ?? null
      );
      this.auditWrite(id, "store", provenance);
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
    const existing = this.get(id);
    if (!existing) return false;

    const content = fields.content ?? existing.content;
    const category = fields.category ?? existing.category;
    const importance = fields.importance
      ? Math.max(1, Math.min(10, fields.importance))
      : existing.importance;
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    this.transaction(() => {
      this.db.prepare(
        `UPDATE memories SET content = ?, category = ?, importance = ?, updated_at = ? WHERE id = ?`
      ).run(content, category, importance, now, id);
      this.auditWrite(id, "update", checked);
    });
    return true;
  }

  delete(id: string, provenance?: WriteProvenance): boolean {
    const checked = this.checkedProvenance(provenance);
    const run = this.db.transaction(() => {
      const result = this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
      if (result.changes > 0) this.auditWrite(id, "delete", checked);
      return result.changes > 0;
    });
    return run();
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
    this.db
      .prepare(
        `INSERT INTO sessions (id, started_at, ended_at, summary, transcript_path, project, checkpoint_memory_id, gap_count, orientation_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        now,
        now,
        data.summary,
        data.transcriptPath ?? null,
        data.project ?? null,
        data.checkpointMemoryId ?? null,
        data.gapCount ?? 0,
        data.orientationScore ?? null
      );
    this.auditSession(id, "create", checked);
    return id;
  }

  updateSession(
    id: string,
    data: { summary?: string; checkpointMemoryId?: string; gapCount?: number; orientationScore?: number },
    provenance?: WriteProvenance
  ): boolean {
    const checked = this.checkedProvenance(provenance);
    const existing = this.getSession(id);
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
    this.auditSession(id, "update", checked);
    return true;
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
