import Database from "better-sqlite3";
import { chmodSync, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createHash, type KeyObject } from "node:crypto";
import { basename, dirname, join, resolve, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { FORMAT_VERSION, entryHash, sortMerkleLeaves, stateHash, type MerkleLeaf } from "./canonical.js";
import { signEntryHash } from "./chain.js";
import { STORE_ID_PATTERN, keyIdOf } from "./keys.js";
import { buildBaselinePayload, parseBaselinePayload } from "./baseline-format.js";
import { computeInventory, type Inventory } from "./inventory.js";
import { resolveStorageRoot } from "../storage/root.js";

// Prepare, baseline and unlock (plan phase 5; spec room 237 as amended by 239 and 241).
// Library functions only: nothing here is wired to a CLI. Every entry point requires the complete
// dependency set and a store path inside a test temp root, and refuses before opening the DB otherwise.
// The path guard protects against mistakes, not against an adversary; the absence of a CLI is what
// keeps a non-test caller out.

export type MaintenanceErrorCode =
  | "deps_missing"
  | "temp_root_invalid"
  | "path_outside_temp_root"
  | "real_store_path"
  | "store_missing"
  | "schema_absent"
  | "invalid_canonical_flag"
  | "already_prepared"
  | "not_prepared"
  | "already_baselined"
  | "maintenance_locked"
  | "chain_not_empty"
  | "key_mismatch"
  | "preflight_refused"
  | "inventory_mismatch"
  | "backup_exists"
  | "lock_lost"
  | "not_locked"
  | "token_mismatch"
  | "verifier_required"
  | "manual_recovery"
  | "unclassified_state";

export class MaintenanceError extends Error {
  readonly code: MaintenanceErrorCode;

  constructor(code: MaintenanceErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "MaintenanceError";
    this.code = code;
  }
}

export interface ProcessObservation {
  pid: number;
  command: string;
  version: string | null;
}

export interface HandleObservation {
  pid: number;
  path: string;
}

export interface LauncherObservation {
  path: string;
  description: string;
}

// Every field is required. Tests inject all of them; there are no defaults that could reach a real
// keychain, process table or path.
export interface MaintenanceDeps {
  tempRoot: string;
  keyLoader: (store_id: string, canonical: boolean) => KeyObject;
  processSource: () => ProcessObservation[];
  handleSource: (paths: string[]) => HandleObservation[];
  launcherSource: () => LauncherObservation[];
  clock: () => Date;
  randomBytes: (size: number) => Buffer;
  onStep: (step: BaselineStep) => void;
}

export type BaselineStep =
  | "locked"
  | "inventoried"
  | "backed_up"
  | "inventory_checked"
  | "baseline_written"
  | "baseline_committed";

const DEP_FIELDS = [
  "tempRoot",
  "keyLoader",
  "processSource",
  "handleSource",
  "launcherSource",
  "clock",
  "randomBytes",
  "onStep",
] as const;

export const TEMP_ROOT_PATTERN = /^rekindle-p5-[A-Za-z0-9]{6}$/;
const ZERO_HASH = "0".repeat(64);
const NONCE_BYTES = 32;

function checkDeps(deps: MaintenanceDeps | undefined): MaintenanceDeps {
  if (deps === null || typeof deps !== "object") throw new MaintenanceError("deps_missing", "deps are required");
  for (const field of DEP_FIELDS) {
    const value = (deps as unknown as Record<string, unknown>)[field];
    const ok = field === "tempRoot" ? typeof value === "string" : typeof value === "function";
    if (!ok) throw new MaintenanceError("deps_missing", `deps.${field} is required`);
  }
  return deps;
}

function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(root + sep);
}

// Spec 239 item 1. Returns the resolved store path; every check runs before any DB is opened.
export function checkTestPath(storePath: string, tempRoot: string): string {
  const tmpBase = realpathSync(tmpdir());
  const rootResolved = resolve(tempRoot);
  if (!existsSync(rootResolved) || !statSync(rootResolved).isDirectory()) {
    throw new MaintenanceError("temp_root_invalid", "tempRoot must be an existing directory");
  }
  // realpath equal to the lexical path means no component of tempRoot is a symlink.
  if (realpathSync(rootResolved) !== rootResolved) {
    throw new MaintenanceError("temp_root_invalid", "tempRoot must be given as its real path, with no symlinks");
  }
  if (dirname(rootResolved) !== tmpBase || !TEMP_ROOT_PATTERN.test(basename(rootResolved))) {
    throw new MaintenanceError("temp_root_invalid", "tempRoot must be an mkdtemp rekindle-p5- directory directly in the OS temp directory");
  }
  const resolved = resolve(storePath);
  if (!isWithin(resolved, rootResolved) || resolved === rootResolved) {
    throw new MaintenanceError("path_outside_temp_root", "store path must be inside tempRoot");
  }
  if (resolved.split(sep).includes(".rekindle")) {
    throw new MaintenanceError("real_store_path", "store path must not be inside a .rekindle directory");
  }
  const realStore = resolve(resolveStorageRoot().dbPath);
  const homeRekindle = join(homedir(), ".rekindle");
  if (resolved === realStore || isWithin(resolved, homeRekindle)) {
    throw new MaintenanceError("real_store_path", "store path is a real store location");
  }
  if (!existsSync(resolved)) throw new MaintenanceError("store_missing", "store file does not exist");
  if (realpathSync(resolved) !== resolved) {
    throw new MaintenanceError("path_outside_temp_root", "store path must not pass through a symlink");
  }
  return resolved;
}

function openStore(path: string): Database.Database {
  const db = new Database(path, { fileMustExist: true });
  const present = db
    .prepare(
      `SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'
         AND name IN ('provenance_meta', 'provenance_chain', 'provenance_baseline_manifest')`,
    )
    .get() as { n: number };
  if (present.n !== 3) {
    db.close();
    throw new MaintenanceError("schema_absent", "the provenance schema is absent");
  }
  return db;
}

interface MetaRow {
  store_id: string | null;
  format_version: number | null;
  canonical: number | null;
  active_key_id: string | null;
  chain_enabled: number;
  baseline_seq: number | null;
  maintenance_lock_token: string | null;
  maintenance_lock_started_at: string | null;
}

function readMeta(db: Database.Database): MetaRow {
  return db
    .prepare(
      `SELECT store_id, format_version, canonical, active_key_id, chain_enabled, baseline_seq,
              maintenance_lock_token, maintenance_lock_started_at
         FROM provenance_meta WHERE id = 1`,
    )
    .get() as MetaRow;
}

function count(db: Database.Database, table: "provenance_chain" | "provenance_baseline_manifest"): number {
  return (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function chainSequence(db: Database.Database): number | null {
  const row = db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'provenance_chain'`).get() as
    | { seq: number }
    | undefined;
  return row === undefined ? null : row.seq;
}

function timestamp(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

// ---------------------------------------------------------------------------------------------
// 5a prepare

export function prepare(storePath: string, opts: { canonical: 0 | 1 }, deps: MaintenanceDeps): { store_id: string } {
  const d = checkDeps(deps);
  const path = checkTestPath(storePath, d.tempRoot);
  if (opts === null || typeof opts !== "object" || (opts.canonical !== 0 && opts.canonical !== 1)) {
    throw new MaintenanceError("invalid_canonical_flag", "canonical must be exactly 0 or 1");
  }
  const db = openStore(path);
  try {
    return db
      .transaction(() => {
        const meta = readMeta(db);
        if (meta.maintenance_lock_token !== null) throw new MaintenanceError("maintenance_locked", "store is locked");
        if (meta.chain_enabled !== 0) throw new MaintenanceError("already_baselined", "chain is enabled");
        if (meta.store_id !== null) throw new MaintenanceError("already_prepared", "store_id is already set");
        if (count(db, "provenance_chain") !== 0 || count(db, "provenance_baseline_manifest") !== 0) {
          throw new MaintenanceError("chain_not_empty", "chain or manifest rows exist");
        }
        const store_id = d.randomBytes(16).toString("hex");
        if (!STORE_ID_PATTERN.test(store_id)) throw new Error("prepare: generated store_id has the wrong format");
        const result = db
          .prepare(
            `UPDATE provenance_meta SET store_id = ?, format_version = ?, canonical = ?
               WHERE id = 1 AND store_id IS NULL AND chain_enabled = 0 AND maintenance_lock_token IS NULL`,
          )
          .run(store_id, FORMAT_VERSION, opts.canonical);
        if (result.changes !== 1) throw new MaintenanceError("already_prepared", "prepare changed no row");
        return { store_id };
      })
      .immediate();
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Crash-state classification (spec 237 E as amended by 239 item 2)

export type CrashRow = "R0" | "R1" | "R2" | "R3" | "unclassified";

export interface Classification {
  row: CrashRow;
  token: string | null;
  started_at: string | null;
  detail: string;
}

// B: the baseline entry itself is well formed and its manifest is complete. Whether later entries
// exist is not part of B; a locked store additionally requires that the baseline is the only entry.
function baselineHolds(db: Database.Database, meta: MetaRow): string | null {
  if (meta.baseline_seq === null) return "baseline_seq is NULL";
  const baselines = db.prepare(`SELECT seq FROM provenance_chain WHERE audit_kind = 'baseline'`).all() as { seq: number }[];
  if (baselines.length !== 1 || baselines[0].seq !== meta.baseline_seq) return "not exactly one baseline entry at baseline_seq";
  const entry = db
    .prepare(`SELECT store_id, format_version, meta_payload FROM provenance_chain WHERE seq = ?`)
    .get(meta.baseline_seq) as { store_id: string; format_version: number; meta_payload: string };
  if (entry.store_id !== meta.store_id || entry.format_version !== meta.format_version) {
    return "baseline entry does not match this store";
  }
  let leafCount: number;
  try {
    leafCount = parseBaselinePayload(entry.meta_payload, entry.format_version).leaf_count;
  } catch (e: unknown) {
    return e instanceof Error ? e.message : "baseline payload is invalid";
  }
  if (count(db, "provenance_baseline_manifest") !== leafCount) return "manifest row count does not equal leaf_count";
  return null;
}

export function classify(db: Database.Database): Classification {
  const meta = readMeta(db);
  const locked = meta.maintenance_lock_token !== null;
  const lock = { token: meta.maintenance_lock_token, started_at: meta.maintenance_lock_started_at };
  const lockState = locked ? "locked" : "unlocked";
  if (meta.chain_enabled === 1) {
    const broken = baselineHolds(db, meta);
    if (broken !== null) return { row: "R3", ...lock, detail: `${lockState}; ${broken}` };
    if (!locked) return { row: "R0", ...lock, detail: "not locked" };
    if (count(db, "provenance_chain") === 1 && chainSequence(db) === meta.baseline_seq) {
      return { row: "R2", ...lock, detail: "locked after the baseline committed" };
    }
    return { row: "unclassified", ...lock, detail: "locked, enabled, with entries after the baseline" };
  }
  if (!locked) return { row: "R0", ...lock, detail: "not locked" };
  if (meta.baseline_seq === null && count(db, "provenance_chain") === 0 && count(db, "provenance_baseline_manifest") === 0) {
    return { row: "R1", ...lock, detail: "locked before the baseline committed" };
  }
  return { row: "unclassified", ...lock, detail: "locked, disabled, with chain or manifest rows" };
}

// ---------------------------------------------------------------------------------------------
// unlock

export interface UnlockResult {
  row: CrashRow;
  cleared: boolean;
  detail: string;
}

export function unlock(
  storePath: string,
  opts: { token: string; force_token?: string },
  deps: MaintenanceDeps,
): UnlockResult {
  const d = checkDeps(deps);
  const path = checkTestPath(storePath, d.tempRoot);
  const db = openStore(path);
  try {
    // Classification and the clear share one immediate transaction; the clear's predicate still
    // restates the complete R1 state rather than trusting the classification.
    return db
      .transaction((): UnlockResult => {
        const state = classify(db);
        if (state.row === "R3") throw new MaintenanceError("manual_recovery", state.detail);
        if (state.row === "R0") return { row: "R0", cleared: false, detail: state.detail };
        // R4: the caller must hold the stored token, or name it exactly with force_token.
        const held = opts.token === state.token || (opts.force_token !== undefined && opts.force_token === state.token);
        if (!held) throw new MaintenanceError("token_mismatch", "the caller does not hold the stored lock token");
        if (state.row === "R2") {
          throw new MaintenanceError("verifier_required", "clearing after a committed baseline needs the phase 6 verifier");
        }
        if (state.row !== "R1") throw new MaintenanceError("unclassified_state", state.detail);
        const result = db
          .prepare(
            `UPDATE provenance_meta SET maintenance_lock_token = NULL, maintenance_lock_started_at = NULL
               WHERE id = 1 AND maintenance_lock_token = ? AND maintenance_lock_started_at = ?
                 AND chain_enabled = 0 AND baseline_seq IS NULL
                 AND (SELECT count(*) FROM provenance_chain) = 0
                 AND (SELECT count(*) FROM provenance_baseline_manifest) = 0`,
          )
          .run(state.token, state.started_at);
        if (result.changes !== 1) throw new MaintenanceError("lock_lost", "the lock changed between classification and clear");
        return { row: "R1", cleared: true, detail: state.detail };
      })
      .immediate();
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------------------------
// 5c baseline

export interface PreflightReport {
  processes: ProcessObservation[];
  handles: HandleObservation[];
  launchers: LauncherObservation[];
}

export interface BaselineReceipt {
  store_id: string;
  key_id: string;
  holder_token: string;
  started_at: string;
  inventory_hash: string;
  backup: { path: string; sha256: string; mode: number };
  leaf_count: number;
  root: string;
  manifest_hash: string;
  baseline_seq: number;
  entry_hash: string;
  preflight: PreflightReport;
}

// Step 0: inspect and refuse, never terminate. Any other Rekindle process refuses, whatever its
// version (stricter than the plan's pre-phase-3 rule; see the phase 5 report).
function preflight(path: string, d: MaintenanceDeps): PreflightReport {
  const processes = d.processSource();
  const handles = d.handleSource([path, `${path}-wal`, `${path}-shm`]);
  const launchers = d.launcherSource();
  const others = processes.filter((p) => p.pid !== process.pid);
  const foreignHandles = handles.filter((h) => h.pid !== process.pid);
  if (others.length > 0 || foreignHandles.length > 0) {
    const pids = [...new Set([...others.map((p) => p.pid), ...foreignHandles.map((h) => h.pid)])].sort((a, b) => a - b);
    throw new MaintenanceError("preflight_refused", `other Rekindle processes or handles are present: pids ${pids.join(", ")}`);
  }
  return { processes, handles, launchers };
}

function leavesAndNonces(db: Database.Database, d: MaintenanceDeps): MerkleLeaf[] {
  const leaves: MerkleLeaf[] = [];
  for (const [kind, table] of [["memory", "memories"], ["session", "sessions"]] as const) {
    const ids = (db.prepare(`SELECT id FROM ${table} ORDER BY id COLLATE BINARY`).all() as { id: string }[]).map((r) => r.id);
    for (const id of ids) {
      let row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown>;
      if (row.nonce === null) {
        const nonce = d.randomBytes(NONCE_BYTES);
        if (nonce.length !== NONCE_BYTES) throw new Error("baseline: nonce has the wrong length");
        db.prepare(`UPDATE ${table} SET nonce = ? WHERE id = ? AND nonce IS NULL`).run(nonce, id);
        row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown>;
      }
      leaves.push({ kind, target_id: id, state_hash: stateHash(kind, row.nonce as Buffer, row) });
    }
  }
  return sortMerkleLeaves(leaves);
}

export async function baseline(storePath: string, deps: MaintenanceDeps): Promise<BaselineReceipt> {
  const d = checkDeps(deps);
  const path = checkTestPath(storePath, d.tempRoot);
  const preflightReport = preflight(path, d);
  const db = openStore(path);
  try {
    // Step 1: refusal checks.
    const meta = readMeta(db);
    if (meta.chain_enabled !== 0) throw new MaintenanceError("already_baselined", "chain is already enabled");
    if (meta.maintenance_lock_token !== null) throw new MaintenanceError("maintenance_locked", "store is locked");
    if (meta.store_id === null || meta.format_version !== FORMAT_VERSION || meta.canonical === null) {
      throw new MaintenanceError("not_prepared", "store is not prepared");
    }
    if (meta.active_key_id === null) throw new MaintenanceError("key_mismatch", "no active key is set");
    if (count(db, "provenance_chain") !== 0 || count(db, "provenance_baseline_manifest") !== 0 || chainSequence(db) !== null) {
      throw new MaintenanceError("chain_not_empty", "chain, manifest or chain sequence rows exist");
    }
    const store_id = meta.store_id;
    const key = d.keyLoader(store_id, meta.canonical === 1);
    const key_id = keyIdOf(key);
    if (key_id !== meta.active_key_id) throw new MaintenanceError("key_mismatch", "loaded key is not the active key");

    // Step 2: one immediate transaction taking the maintenance lock.
    const holder_token = d.randomBytes(16).toString("hex");
    const started_at = timestamp(d.clock());
    db.transaction(() => {
      const locked = db
        .prepare(
          `UPDATE provenance_meta SET maintenance_lock_token = ?, maintenance_lock_started_at = ?
             WHERE id = 1 AND maintenance_lock_token IS NULL AND chain_enabled = 0 AND baseline_seq IS NULL
               AND store_id = ? AND active_key_id = ?
               AND (SELECT count(*) FROM provenance_chain) = 0
               AND (SELECT count(*) FROM provenance_baseline_manifest) = 0`,
        )
        .run(holder_token, started_at, store_id, key_id);
      if (locked.changes !== 1) throw new MaintenanceError("maintenance_locked", "the lock could not be taken");
    }).immediate();
    d.onStep("locked");

    // Step 3: P1, backup, P2.
    const p1 = computeInventory(db);
    d.onStep("inventoried");
    const backupPath = join(dirname(path), `baseline-backup-${started_at.replace(/[^0-9]/g, "")}-${holder_token.slice(0, 8)}.db`);
    if (existsSync(backupPath)) throw new MaintenanceError("backup_exists", "backup path already exists");
    await db.backup(backupPath);
    chmodSync(backupPath, 0o600);
    const p2 = withReadonly(backupPath, computeInventory);
    if (p2.document !== p1.document) throw new MaintenanceError("inventory_mismatch", "backup inventory differs from the live inventory");
    const backup = {
      path: backupPath,
      sha256: createHash("sha256").update(readFileSync(backupPath)).digest("hex"),
      mode: statSync(backupPath).mode & 0o777,
    };
    d.onStep("backed_up");

    // Step 4: one immediate transaction from P3 through the enabled chain.
    const written = db
      .transaction(() => {
        const p3: Inventory = computeInventory(db);
        if (p3.document !== p1.document) throw new MaintenanceError("inventory_mismatch", "live inventory changed under the lock");
        d.onStep("inventory_checked");
        const leaves = leavesAndNonces(db, d);
        const insertLeaf = db.prepare(
          `INSERT INTO provenance_baseline_manifest (ordinal, kind, target_id, state_hash) VALUES (?, ?, ?, ?)`,
        );
        leaves.forEach((leaf, ordinal) => insertLeaf.run(ordinal, leaf.kind, leaf.target_id, leaf.state_hash));
        const meta_payload = buildBaselinePayload(leaves, p3.hash);
        const created_at = timestamp(d.clock());
        const fields = {
          seq: 1,
          store_id,
          format_version: FORMAT_VERSION,
          audit_kind: "baseline",
          audit_id: null,
          target_id: null,
          action: "baseline",
          state_hash: null,
          prior_state_hash: null,
          meta_payload,
          prev_hash: ZERO_HASH,
          key_id,
          created_at,
          client: null,
          thread_id: null,
          request_id: null,
          author_identity: null,
          authorization_reference: null,
          authorization_verified: 0,
        };
        const entry_hash = entryHash(fields);
        db.prepare(
          `INSERT INTO provenance_chain (seq, store_id, format_version, audit_kind, audit_id, target_id, action,
             state_hash, prior_state_hash, meta_payload, prev_hash, entry_hash, key_id, signature, created_at)
           VALUES (1, ?, ?, 'baseline', NULL, NULL, 'baseline', NULL, NULL, ?, ?, ?, ?, ?, ?)`,
        ).run(store_id, FORMAT_VERSION, meta_payload, ZERO_HASH, entry_hash, key_id, signEntryHash(entry_hash, key), created_at);
        const enabled = db
          .prepare(
            `UPDATE provenance_meta SET chain_enabled = 1, baseline_seq = 1
               WHERE id = 1 AND maintenance_lock_token = ? AND maintenance_lock_started_at = ? AND chain_enabled = 0`,
          )
          .run(holder_token, started_at);
        if (enabled.changes !== 1) throw new MaintenanceError("lock_lost", "the lock changed before the baseline was written");
        d.onStep("baseline_written");
        const payload = parseBaselinePayload(meta_payload, FORMAT_VERSION);
        return { leaf_count: payload.leaf_count, root: payload.root, manifest_hash: payload.manifest_hash, inventory_hash: p3.hash, entry_hash };
      })
      .immediate();
    d.onStep("baseline_committed");

    // Step 5: one immediate transaction clearing the lock, conditioned on the token, started_at and
    // the complete R2 state.
    db.transaction(() => {
      const cleared = db
        .prepare(
          `UPDATE provenance_meta SET maintenance_lock_token = NULL, maintenance_lock_started_at = NULL
             WHERE id = 1 AND maintenance_lock_token = ? AND maintenance_lock_started_at = ?
               AND chain_enabled = 1 AND baseline_seq = 1
               AND (SELECT count(*) FROM provenance_chain) = 1
               AND (SELECT seq FROM sqlite_sequence WHERE name = 'provenance_chain') = 1
               AND (SELECT count(*) FROM provenance_baseline_manifest) = ?`,
        )
        .run(holder_token, started_at, written.leaf_count);
      if (cleared.changes !== 1) throw new MaintenanceError("lock_lost", "the lock changed before it could be cleared");
    }).immediate();

    return {
      store_id,
      key_id,
      holder_token,
      started_at,
      inventory_hash: written.inventory_hash,
      backup,
      leaf_count: written.leaf_count,
      root: written.root,
      manifest_hash: written.manifest_hash,
      baseline_seq: 1,
      entry_hash: written.entry_hash,
      preflight: preflightReport,
    };
  } finally {
    db.close();
  }
}

function withReadonly<T>(path: string, fn: (db: Database.Database) => T): T {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    db.pragma("query_only = ON");
    return fn(db);
  } finally {
    db.close();
  }
}
