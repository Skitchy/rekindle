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
`;

export class RekindleStorage {
  private db: Database.Database;

  constructor(dbPath: string) {
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

  store(
    content: string,
    category: MemoryCategory = "general",
    importance: number = 5,
    project?: string,
    opts?: { type?: string; source?: string; session_id?: string }
  ): string {
    const id = generateId();
    const stmt = this.db.prepare(`
      INSERT INTO memories (id, content, category, importance, project, type, source, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      content,
      category,
      Math.max(1, Math.min(10, importance)),
      project ?? null,
      opts?.type ?? "memory",
      opts?.source ?? "manual",
      opts?.session_id ?? null
    );
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
    fields: { content?: string; category?: MemoryCategory; importance?: number }
  ): boolean {
    const existing = this.get(id);
    if (!existing) return false;

    const content = fields.content ?? existing.content;
    const category = fields.category ?? existing.category;
    const importance = fields.importance
      ? Math.max(1, Math.min(10, fields.importance))
      : existing.importance;
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    this.db
      .prepare(
        `UPDATE memories SET content = ?, category = ?, importance = ?, updated_at = ? WHERE id = ?`
      )
      .run(content, category, importance, now, id);
    return true;
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM memories WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  stats(): MemoryStats {
    const total = (
      this.db.prepare(`SELECT COUNT(*) as count FROM memories`).get() as {
        count: number;
      }
    ).count;

    const catRows = this.db
      .prepare(
        `SELECT category, COUNT(*) as count FROM memories GROUP BY category`
      )
      .all() as { category: string; count: number }[];
    const byCategory: Record<string, number> = {};
    for (const row of catRows) {
      byCategory[row.category] = row.count;
    }

    const projRows = this.db
      .prepare(
        `SELECT COALESCE(project, '(none)') as project, COUNT(*) as count FROM memories GROUP BY project`
      )
      .all() as { project: string; count: number }[];
    const byProject: Record<string, number> = {};
    for (const row of projRows) {
      byProject[row.project] = row.count;
    }

    const recentCount = (
      this.db
        .prepare(
          `SELECT COUNT(*) as count FROM memories WHERE created_at > datetime('now', '-7 days')`
        )
        .get() as { count: number }
    ).count;

    return { total, byCategory, byProject, recentCount };
  }

  getLatestCheckpoint(project?: string): Memory | null {
    let sql = `SELECT * FROM memories WHERE type = 'checkpoint'`;
    const params: string[] = [];

    if (project) {
      sql += ` AND project = ?`;
      params.push(project);
    }

    sql += ` ORDER BY created_at DESC, rowid DESC LIMIT 1`;

    let row = this.db.prepare(sql).get(...params) as Memory | undefined;
    if (!row) {
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
  }): string {
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
    return id;
  }

  updateSession(
    id: string,
    data: { summary?: string; checkpointMemoryId?: string; gapCount?: number; orientationScore?: number }
  ): boolean {
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
    return true;
  }

  getSession(id: string): Session | null {
    const row = this.db
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(id) as Session | undefined;
    return row ?? null;
  }

  close(): void {
    this.db.close();
  }
}
