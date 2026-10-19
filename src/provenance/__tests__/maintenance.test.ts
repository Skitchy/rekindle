import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash, verify } from "node:crypto";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RekindleStorage, ProvenanceWriteError } from "../../storage/sqlite.js";
import { keyFromSeed, keyIdOf, TEST_SEED_ENV } from "../keys.js";
import { entryHash, merkleRoot, sortMerkleLeaves, stateHash, type MerkleLeaf } from "../canonical.js";
import { manifestHash, parseBaselinePayload } from "../baseline-format.js";
import { computeInventory, diagnosticInventory, InventoryError } from "../inventory.js";
import {
  MaintenanceError,
  baseline,
  checkTestPath,
  classify,
  prepare,
  unlock,
  type BaselineStep,
  type MaintenanceDeps,
} from "../maintenance.js";

// No test may reach the real /usr/bin/security or start a process (Phase 2 rule): the mock throws.
const { unmocked } = vi.hoisted(() => ({
  unmocked: () => {
    throw new Error("unmocked execFileSync call");
  },
}));
vi.mock("node:child_process", () => ({ execFileSync: vi.fn(unmocked) }));
const mockedExec = vi.mocked(execFileSync);

beforeAll(() => {
  expect(vi.isMockFunction(execFileSync)).toBe(true);
});

// RFC 8032 test seeds (fixed bytes, noncanonical test keys only).
const SEED_1 = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const SEED_2 = "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb";
const KEY_1 = keyFromSeed(Buffer.from(SEED_1, "hex"));
const KEY_2 = keyFromSeed(Buffer.from(SEED_2, "hex"));
const KEY_ID_1 = keyIdOf(KEY_1);
const FIXED_NOW = new Date("2026-10-19T12:00:00Z");

let root: string;
let dbPath: string;
let savedSeed: string | undefined;
let killSpy: ReturnType<typeof vi.spyOn>;

function makeRoot(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "rekindle-p5-")));
}

// Sentinel sources throw if a refusal path reaches them.
function sentinel(name: string) {
  return () => {
    throw new Error(`sentinel ${name} was called`);
  };
}

// Shared across every deps object in a test, so two baseline runs never draw the same bytes.
let counter = 0;

function testDeps(overrides: Partial<MaintenanceDeps> = {}): MaintenanceDeps {
  return {
    tempRoot: root,
    keyLoader: (_store_id, canonical) => {
      if (canonical) throw new Error("test keyLoader refuses canonical stores");
      return KEY_1;
    },
    processSource: () => [],
    handleSource: () => [],
    launcherSource: () => [],
    clock: () => FIXED_NOW,
    // Deterministic, distinct bytes per call.
    randomBytes: (size) => {
      counter += 1;
      return createHash("sha256").update(`test-random:${counter}`).digest().subarray(0, size);
    },
    onStep: () => {},
    ...overrides,
  };
}

function refusalDeps(): MaintenanceDeps {
  return {
    tempRoot: root,
    keyLoader: sentinel("keyLoader"),
    processSource: sentinel("processSource"),
    handleSource: sentinel("handleSource"),
    launcherSource: sentinel("launcherSource"),
    clock: sentinel("clock"),
    randomBytes: sentinel("randomBytes"),
    onStep: sentinel("onStep"),
  };
}

function createStore(path = dbPath, seed: (s: RekindleStorage) => void = () => {}): void {
  const storage = new RekindleStorage(path);
  seed(storage);
  storage.close();
}

function seedRows(storage: RekindleStorage): void {
  storage.store("first memory", "lesson", 7, "rekindle");
  storage.store("second memory", "context", 3);
  storage.createSession({ summary: "a session", project: "rekindle" });
}

function withDb<T>(fn: (db: Database.Database) => T, path = dbPath): T {
  const db = new Database(path, { fileMustExist: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function meta(): Record<string, unknown> {
  return withDb((db) => db.prepare(`SELECT * FROM provenance_meta WHERE id = 1`).get() as Record<string, unknown>);
}

function counts(): { chain: number; manifest: number } {
  return withDb((db) => ({
    chain: (db.prepare(`SELECT count(*) AS n FROM provenance_chain`).get() as { n: number }).n,
    manifest: (db.prepare(`SELECT count(*) AS n FROM provenance_baseline_manifest`).get() as { n: number }).n,
  }));
}

function fileHash(path = dbPath): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// Prepared, with the test key set active as Phase 5b keygen would.
function preparedStore(seed: (s: RekindleStorage) => void = seedRows): string {
  createStore(dbPath, seed);
  const { store_id } = prepare(dbPath, { canonical: 0 }, testDeps());
  withDb((db) => db.prepare(`UPDATE provenance_meta SET active_key_id = ? WHERE id = 1`).run(KEY_ID_1));
  return store_id;
}

function failAt(step: BaselineStep): MaintenanceDeps {
  return testDeps({
    onStep: (s) => {
      if (s === step) throw new Error(`injected fault at ${s}`);
    },
  });
}

async function expectCode(promise: Promise<unknown> | (() => unknown), code: string): Promise<void> {
  try {
    if (typeof promise === "function") promise();
    else await promise;
  } catch (e: unknown) {
    expect((e as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}, nothing was thrown`);
}

beforeEach(() => {
  root = makeRoot();
  dbPath = join(root, "store.db");
  counter = 0;
  savedSeed = process.env[TEST_SEED_ENV];
  process.env[TEST_SEED_ENV] = SEED_1;
  mockedExec.mockClear();
  killSpy = vi.spyOn(process, "kill");
});

afterEach(() => {
  // Zero launches and zero signals in every test.
  expect(mockedExec).not.toHaveBeenCalled();
  expect(killSpy).not.toHaveBeenCalled();
  killSpy.mockRestore();
  if (savedSeed === undefined) delete process.env[TEST_SEED_ENV];
  else process.env[TEST_SEED_ENV] = savedSeed;
  rmSync(root, { recursive: true, force: true });
});

// Spec 237 section D rests on one SQLite behavior: an online backup that sees another connection
// commit mid-copy restarts, so the finished file is a consistent snapshot of the final committed state.
// This is tested before anything is built on it.
describe("online backup API behavior (spec 237 D hypothesis)", () => {
  it("restarts when another connection commits mid-backup, and the result includes that commit", async () => {
    const livePath = join(root, "live.db");
    const backupPath = join(root, "backup.db");
    const source = new Database(livePath);
    source.pragma("journal_mode = WAL");
    source.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    const insert = source.prepare("INSERT INTO t (body) VALUES (?)");
    source.transaction(() => {
      for (let i = 0; i < 400; i++) insert.run("x".repeat(1000));
    })();

    const writer = new Database(livePath);
    const remaining: number[] = [];
    let wrote = false;
    await source.backup(backupPath, {
      progress: ({ remainingPages }) => {
        remaining.push(remainingPages);
        if (!wrote && remaining.length === 3) {
          writer.prepare("INSERT INTO t (body) VALUES (?)").run("mid-backup");
          wrote = true;
        }
        return 1;
      },
    });
    writer.close();

    const copy = new Database(backupPath, { readonly: true });
    const count = copy.prepare("SELECT count(*) AS n FROM t").get() as { n: number };
    const mid = copy.prepare("SELECT count(*) AS n FROM t WHERE body = 'mid-backup'").get() as { n: number };
    const integrity = copy.pragma("integrity_check", { simple: true });
    copy.close();
    source.close();

    const restarted = remaining.some((value, i) => i > 0 && value > remaining[i - 1]);
    expect(wrote).toBe(true);
    expect(restarted).toBe(true);
    expect(count.n).toBe(401);
    expect(mid.n).toBe(1);
    expect(integrity).toBe("ok");
  });

  it("control: without a concurrent commit, remaining pages only decrease", async () => {
    const livePath = join(root, "live.db");
    const source = new Database(livePath);
    source.pragma("journal_mode = WAL");
    source.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    const insert = source.prepare("INSERT INTO t (body) VALUES (?)");
    source.transaction(() => {
      for (let i = 0; i < 400; i++) insert.run("x".repeat(1000));
    })();

    const remaining: number[] = [];
    await source.backup(join(root, "backup.db"), {
      progress: ({ remainingPages }) => {
        remaining.push(remainingPages);
        return 1;
      },
    });
    source.close();

    expect(remaining.length).toBeGreaterThan(3);
    expect(remaining.every((value, i) => i === 0 || value < remaining[i - 1])).toBe(true);
  });
});

describe("test-only boundary (spec 239 item 1)", () => {
  it("refuses every entry point when a dependency is missing, before touching the store", async () => {
    createStore();
    const before = fileHash();
    for (const field of Object.keys(testDeps()) as (keyof MaintenanceDeps)[]) {
      const deps = { ...testDeps() } as Record<string, unknown>;
      delete deps[field];
      await expectCode(() => prepare(dbPath, { canonical: 0 }, deps as unknown as MaintenanceDeps), "deps_missing");
      await expectCode(baseline(dbPath, deps as unknown as MaintenanceDeps), "deps_missing");
      await expectCode(() => unlock(dbPath, { token: "x" }, deps as unknown as MaintenanceDeps), "deps_missing");
    }
    await expectCode(() => prepare(dbPath, { canonical: 0 }, undefined as unknown as MaintenanceDeps), "deps_missing");
    expect(fileHash()).toBe(before);
  });

  it("refuses a real-looking workspace path as tempRoot, with no file created there", async () => {
    const workspace = realpathSync(process.cwd());
    const target = join(workspace, "phase5-should-not-exist.db");
    const deps = { ...refusalDeps(), tempRoot: workspace };
    await expectCode(() => prepare(target, { canonical: 0 }, deps), "temp_root_invalid");
    await expectCode(baseline(target, deps), "temp_root_invalid");
    await expectCode(() => unlock(target, { token: "x" }, deps), "temp_root_invalid");
    expect(existsSync(target)).toBe(false);
  });

  it("refuses the OS temp directory itself, a nested rekindle-p5 directory and a non-matching name", async () => {
    createStore();
    const before = fileHash();
    const nested = join(root, "rekindle-p5-AAAAAA");
    mkdirSync(nested);
    const badName = realpathSync(mkdtempSync(join(tmpdir(), "rekindle-p5x-")));
    try {
      for (const tempRoot of [realpathSync(tmpdir()), nested, badName]) {
        await expectCode(() => prepare(dbPath, { canonical: 0 }, { ...refusalDeps(), tempRoot }), "temp_root_invalid");
      }
    } finally {
      rmSync(badName, { recursive: true, force: true });
    }
    expect(fileHash()).toBe(before);
  });

  it("refuses a tempRoot given through a symlink", async () => {
    createStore();
    const link = join(realpathSync(tmpdir()), `rekindle-link-${process.pid}`);
    symlinkSync(root, link);
    try {
      await expectCode(() => prepare(join(link, "store.db"), { canonical: 0 }, { ...refusalDeps(), tempRoot: link }), "temp_root_invalid");
    } finally {
      rmSync(link, { force: true });
    }
  });

  it("refuses a symlink escape and a .. escape out of tempRoot", async () => {
    const other = makeRoot();
    try {
      const outside = join(other, "store.db");
      createStore(outside);
      const before = fileHash(outside);
      symlinkSync(outside, join(root, "escape.db"));
      await expectCode(() => prepare(join(root, "escape.db"), { canonical: 0 }, refusalDeps()), "path_outside_temp_root");
      await expectCode(() => prepare(join(root, "..", other.split("/").pop()!, "store.db"), { canonical: 0 }, refusalDeps()), "path_outside_temp_root");
      await expectCode(baseline(join(root, "escape.db"), refusalDeps()), "path_outside_temp_root");
      expect(fileHash(outside)).toBe(before);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("refuses any path through a .rekindle directory and the resolved real store path", async () => {
    mkdirSync(join(root, ".rekindle", "db"), { recursive: true });
    await expectCode(() => checkTestPath(join(root, ".rekindle", "db", "memories.db"), root), "real_store_path");
    const saved = process.env.REKINDLE_DB_PATH;
    process.env.REKINDLE_DB_PATH = dbPath;
    try {
      createStore();
      await expectCode(() => prepare(dbPath, { canonical: 0 }, refusalDeps()), "real_store_path");
    } finally {
      if (saved === undefined) delete process.env.REKINDLE_DB_PATH;
      else process.env.REKINDLE_DB_PATH = saved;
    }
  });

  it("refuses the temp root itself and a missing store file", async () => {
    await expectCode(() => checkTestPath(root, root), "path_outside_temp_root");
    await expectCode(() => checkTestPath(join(root, "absent.db"), root), "store_missing");
  });
});

describe("5a prepare", () => {
  it.each([0, 1] as const)("writes store_id, format_version 1 and canonical = %i, with the chain disabled", (canonical) => {
    createStore();
    const { store_id } = prepare(dbPath, { canonical }, testDeps());
    expect(store_id).toMatch(/^[0-9a-f]{32}$/);
    expect(meta()).toMatchObject({
      store_id,
      format_version: 1,
      canonical,
      active_key_id: null,
      chain_enabled: 0,
      baseline_seq: null,
      maintenance_lock_token: null,
    });
  });

  it("refuses a second prepare with no change", async () => {
    createStore();
    prepare(dbPath, { canonical: 0 }, testDeps());
    const before = meta();
    await expectCode(() => prepare(dbPath, { canonical: 0 }, testDeps()), "already_prepared");
    expect(meta()).toEqual(before);
  });

  it.each([true, 2, "0", undefined])("refuses canonical = %s", async (canonical) => {
    createStore();
    await expectCode(
      () => prepare(dbPath, { canonical } as unknown as { canonical: 0 | 1 }, testDeps()),
      "invalid_canonical_flag",
    );
    expect(meta().store_id).toBeNull();
  });

  it("refuses a store without the provenance schema", async () => {
    const db = new Database(dbPath);
    db.exec("CREATE TABLE unrelated (id INTEGER)");
    db.close();
    await expectCode(() => prepare(dbPath, { canonical: 0 }, testDeps()), "schema_absent");
  });
});

describe("5c baseline", () => {
  it("baselines a populated store and leaves a chain the phase 4 write path extends", async () => {
    const store_id = preparedStore();
    // P1 already includes the lock token, so the pre-lock inventory must NOT equal H(P3).
    const preLock = withDb((db) => computeInventory(db));
    const receipt = await baseline(dbPath, testDeps());
    const fromBackup = withDb((db) => computeInventory(db), receipt.backup.path);
    expect(preLock.hash).not.toBe(receipt.inventory_hash);

    expect(meta()).toMatchObject({ chain_enabled: 1, baseline_seq: 1, maintenance_lock_token: null, maintenance_lock_started_at: null });
    expect(receipt).toMatchObject({ store_id, key_id: KEY_ID_1, baseline_seq: 1, leaf_count: 3 });

    withDb((db) => {
      // Every live row has a nonce and a leaf matching its state.
      const leaves = db.prepare(`SELECT ordinal, kind, target_id, state_hash FROM provenance_baseline_manifest ORDER BY ordinal`).all() as (MerkleLeaf & { ordinal: number })[];
      expect(leaves.map((l) => l.ordinal)).toEqual([0, 1, 2]);
      const plain = leaves.map(({ kind, target_id, state_hash }) => ({ kind, target_id, state_hash }));
      expect(sortMerkleLeaves(plain)).toEqual(plain);
      for (const leaf of plain) {
        const table = leaf.kind === "memory" ? "memories" : "sessions";
        const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(leaf.target_id) as Record<string, unknown>;
        expect((row.nonce as Buffer).length).toBe(32);
        expect(stateHash(leaf.kind, row.nonce as Buffer, row)).toBe(leaf.state_hash);
      }

      // The signed entry binds the payload, which binds the manifest and the P3 inventory.
      const entry = db.prepare(`SELECT * FROM provenance_chain WHERE seq = 1`).get() as Record<string, unknown>;
      const payload = parseBaselinePayload(entry.meta_payload as string, 1);
      expect(payload.root).toBe(merkleRoot(plain));
      expect(payload.manifest_hash).toBe(manifestHash(plain));
      expect(payload.leaf_count).toBe(3);
      expect(payload.inventory_hash).toBe(receipt.inventory_hash);
      // (a) inventory_hash is H(P3); the backup, recomputed independently, is the same snapshot.
      expect(payload.inventory_hash).toBe(fromBackup.hash);
      // (b) the field is inside the stored text entryHash binds, and the signature verifies.
      const recomputed = entryHash({
        seq: 1, store_id, format_version: 1, audit_kind: "baseline", audit_id: null, target_id: null,
        action: "baseline", state_hash: null, prior_state_hash: null, meta_payload: entry.meta_payload,
        prev_hash: entry.prev_hash, key_id: KEY_ID_1, created_at: entry.created_at, client: null, thread_id: null,
        request_id: null, author_identity: null, authorization_reference: null, authorization_verified: 0,
      });
      expect(entry.entry_hash).toBe(recomputed);
      expect(entry.meta_payload as string).toContain(`"inventory_hash":"${fromBackup.hash}"`);
      expect(verify(null, Buffer.from(recomputed, "hex"), KEY_1, Buffer.from(entry.signature as string, "hex"))).toBe(true);
      expect(entry.created_at).toBe("2026-10-19 12:00:00");
    });

    // (c) the backup reproduces H(P3) and is mode 0600.
    expect(receipt.backup.mode).toBe(0o600);
    expect(statSync(receipt.backup.path).mode & 0o777).toBe(0o600);
    expect(fileHash(receipt.backup.path)).toBe(receipt.backup.sha256);
    expect(fromBackup.hash).toBe(receipt.inventory_hash);

    // (d) a post-baseline recompute differs from H(P3), and that difference is expected, not corruption:
    // the baseline itself added nonces, the manifest, the chain entry, chain_enabled and the lock clear.
    // The diagnostic recompute uses the same document rule; on the backup it reproduces H(P3) exactly.
    expect(withDb((db) => diagnosticInventory(db), receipt.backup.path).document).toBe(fromBackup.document);
    const postBaseline = withDb((db) => diagnosticInventory(db));
    expect(postBaseline.hash).not.toBe(receipt.inventory_hash);
    expect(JSON.parse(postBaseline.document).asserts).toEqual({ provenance_chain_empty: false, manifest_empty: false });
    // The baseline-authorizing inventory still refuses a non-empty chain.
    await expectCode(() => withDb((db) => computeInventory(db)), "inventory_not_empty");

    // The phase 4 write path accepts this baseline and links to it.
    const storage = new RekindleStorage(dbPath);
    storage.store("after baseline", "general");
    storage.close();
    withDb((db) => {
      const rows = db.prepare(`SELECT seq, prev_hash, entry_hash FROM provenance_chain ORDER BY seq`).all() as { seq: number; prev_hash: string; entry_hash: string }[];
      expect(rows.map((r) => r.seq)).toEqual([1, 2]);
      expect(rows[1].prev_hash).toBe(rows[0].entry_hash);
    });
  });

  it("baselines an empty store with the empty root", async () => {
    preparedStore(() => {});
    const receipt = await baseline(dbPath, testDeps());
    expect(receipt.leaf_count).toBe(0);
    expect(receipt.root).toBe(merkleRoot([]));
    expect(counts()).toEqual({ chain: 1, manifest: 0 });
  });

  it("refuses an unprepared store, touching only the preflight sources", async () => {
    createStore();
    const before = fileHash();
    await expectCode(baseline(dbPath, { ...refusalDeps(), processSource: () => [], handleSource: () => [], launcherSource: () => [] }), "not_prepared");
    expect(fileHash()).toBe(before);
  });

  it("refuses a re-baseline of an already-baselined store with no writes", async () => {
    preparedStore();
    await baseline(dbPath, testDeps());
    const before = meta();
    const beforeCounts = counts();
    await expectCode(baseline(dbPath, testDeps()), "already_baselined");
    expect(meta()).toEqual(before);
    expect(counts()).toEqual(beforeCounts);
  });

  it("refuses when no key is active, or the loaded key is not the active key", async () => {
    createStore(dbPath, seedRows);
    prepare(dbPath, { canonical: 0 }, testDeps());
    await expectCode(baseline(dbPath, testDeps()), "key_mismatch");
    withDb((db) => db.prepare(`UPDATE provenance_meta SET active_key_id = ? WHERE id = 1`).run(KEY_ID_1));
    await expectCode(baseline(dbPath, testDeps({ keyLoader: () => KEY_2 })), "key_mismatch");
    expect(meta()).toMatchObject({ chain_enabled: 0, maintenance_lock_token: null });
  });

  it("refuses a dirty chain sequence even when the chain is empty", async () => {
    preparedStore();
    withDb((db) => db.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES ('provenance_chain', 5)`).run());
    await expectCode(baseline(dbPath, testDeps()), "chain_not_empty");
    expect(meta().maintenance_lock_token).toBeNull();
  });

  it.each([
    ["another Rekindle process", { processSource: () => [{ pid: process.pid + 1, command: "rekindle-mcp", version: "0.9.0" }] }],
    ["a foreign handle on the -wal file", { handleSource: (paths: string[]) => [{ pid: process.pid + 7, path: paths[1] }] }],
  ])("preflight refuses %s and never locks", async (_label, override) => {
    preparedStore();
    const before = meta();
    await expectCode(baseline(dbPath, testDeps(override as Partial<MaintenanceDeps>)), "preflight_refused");
    expect(meta()).toEqual(before);
  });

  it("refuses a REAL value with the lock held, which unlock then clears as R1", async () => {
    preparedStore();
    withDb((db) => db.prepare(`UPDATE memories SET importance = 5.5 WHERE rowid = 1`).run());
    let token = "";
    await expectCode(
      baseline(dbPath, testDeps({ onStep: () => {} , randomBytes: (n) => { const b = Buffer.alloc(n, 0xab); token = b.toString("hex"); return b; } })),
      "inventory_unsupported_value",
    );
    expect(meta()).toMatchObject({ chain_enabled: 0, maintenance_lock_token: token });
    expect(unlock(dbPath, { token }, testDeps())).toMatchObject({ row: "R1", cleared: true });
  });

  it("a write after the lock but before P1 is part of the baselined state, not a mismatch", async () => {
    preparedStore();
    const deps = testDeps({
      onStep: (s) => {
        if (s === "locked") withDb((db) => db.prepare(`UPDATE memories SET content = 'before P1' WHERE rowid = 1`).run());
      },
    });
    const receipt = await baseline(dbPath, deps);
    expect(withDb((db) => (db.prepare(`SELECT content FROM memories WHERE rowid = 1`).get() as { content: string }).content)).toBe("before P1");
    expect(withDb((db) => computeInventory(db), receipt.backup.path).hash).toBe(receipt.inventory_hash);
  });

  // "inventoried": between P1 and the backup, so P2 differs. "backed_up": between P2 and P3, so P3 differs.
  it.each(["inventoried", "backed_up"] as const)("detects a write by another connection after step %s and refuses as R1", async (step) => {
    preparedStore();
    const deps = testDeps({
      onStep: (s) => {
        if (s === step) withDb((db) => db.prepare(`UPDATE memories SET content = 'changed' WHERE rowid = 1`).run());
      },
    });
    await expectCode(baseline(dbPath, deps), "inventory_mismatch");
    expect(meta()).toMatchObject({ chain_enabled: 0, baseline_seq: null });
    expect(meta().maintenance_lock_token).not.toBeNull();
    expect(counts()).toEqual({ chain: 0, manifest: 0 });
    expect(withDb((db) => classify(db)).row).toBe("R1");
  });

  it("only P2 catches a backup of a transient state: a write undone before P3 still refuses", async () => {
    preparedStore();
    let original = "";
    const deps = testDeps({
      onStep: (s) => {
        if (s === "inventoried") {
          withDb((db) => {
            original = (db.prepare(`SELECT content FROM memories WHERE rowid = 1`).get() as { content: string }).content;
            db.prepare(`UPDATE memories SET content = 'transient' WHERE rowid = 1`).run();
          });
        }
      },
    });
    // The backup step is async, so the revert runs from the backup's own progress: the live store is
    // restored right after the backup finishes, before P3 is computed.
    const realBackup = Database.prototype.backup;
    const spy = vi.spyOn(Database.prototype, "backup").mockImplementation(async function (this: Database.Database, ...args) {
      const result = await realBackup.apply(this, args as Parameters<typeof realBackup>);
      withDb((db) => db.prepare(`UPDATE memories SET content = ? WHERE rowid = 1`).run(original));
      return result;
    });
    try {
      await expectCode(baseline(dbPath, deps), "inventory_mismatch");
    } finally {
      spy.mockRestore();
    }
    expect(meta()).toMatchObject({ chain_enabled: 0, baseline_seq: null });
    expect(counts()).toEqual({ chain: 0, manifest: 0 });
  });

  it("phase 4 semantic writes refuse with maintenance_locked while the lock is held (chain still disabled)", async () => {
    preparedStore();
    await baseline(dbPath, failAt("locked")).catch(() => {});
    expect(meta()).toMatchObject({ chain_enabled: 0 });
    const before = withDb((db) => (db.prepare(`SELECT count(*) AS n FROM memories`).get() as { n: number }).n);
    const storage = new RekindleStorage(dbPath);
    try {
      await expectCode(() => storage.store("during the lock", "general"), "maintenance_locked");
    } finally {
      storage.close();
    }
    expect(withDb((db) => (db.prepare(`SELECT count(*) AS n FROM memories`).get() as { n: number }).n)).toBe(before);
  });
});

describe("lock ownership and crash states (spec 237 E, 239 item 2)", () => {
  async function lockedAt(step: BaselineStep): Promise<{ token: string; started_at: string }> {
    preparedStore();
    await baseline(dbPath, failAt(step)).catch((e: unknown) => {
      expect((e as Error).message).toContain("injected fault");
    });
    const m = meta();
    return { token: m.maintenance_lock_token as string, started_at: m.maintenance_lock_started_at as string };
  }

  it("R0: unlock on an unlocked store writes nothing", () => {
    createStore();
    const before = fileHash();
    expect(unlock(dbPath, { token: "none" }, testDeps())).toEqual({ row: "R0", cleared: false, detail: "not locked" });
    expect(fileHash()).toBe(before);
  });

  it("R1 (fault after locking): the holder clears it; a wrong token does not", async () => {
    const { token } = await lockedAt("locked");
    expect(withDb((db) => classify(db)).row).toBe("R1");
    await expectCode(() => unlock(dbPath, { token: "f".repeat(32) }, testDeps()), "token_mismatch");
    expect(meta().maintenance_lock_token).toBe(token);
    expect(unlock(dbPath, { token }, testDeps())).toMatchObject({ row: "R1", cleared: true });
    expect(meta()).toMatchObject({ maintenance_lock_token: null, maintenance_lock_started_at: null });
  });

  it("R4: force_token clears only when it names the stored token exactly", async () => {
    const { token } = await lockedAt("locked");
    await expectCode(() => unlock(dbPath, { token: "x", force_token: token.slice(0, -1) }, testDeps()), "token_mismatch");
    expect(unlock(dbPath, { token: "x", force_token: token }, testDeps())).toMatchObject({ row: "R1", cleared: true });
  });

  it("a replaced lock refuses the old holder", async () => {
    const { token } = await lockedAt("locked");
    withDb((db) =>
      db.prepare(`UPDATE provenance_meta SET maintenance_lock_token = ?, maintenance_lock_started_at = ? WHERE id = 1`).run("b".repeat(32), "2026-10-19 13:00:00"),
    );
    await expectCode(() => unlock(dbPath, { token }, testDeps()), "token_mismatch");
    expect(meta().maintenance_lock_token).toBe("b".repeat(32));
  });

  it("a stale token after reacquisition is refused", async () => {
    const first = await lockedAt("locked");
    unlock(dbPath, { token: first.token }, testDeps());
    await baseline(dbPath, failAt("locked")).catch(() => {});
    const second = meta().maintenance_lock_token as string;
    expect(second).not.toBe(first.token);
    await expectCode(() => unlock(dbPath, { token: first.token }, testDeps()), "token_mismatch");
    expect(meta().maintenance_lock_token).toBe(second);
  });

  it("a fault inside the baseline transaction rolls back everything but the lock", async () => {
    const nonceCount = () => withDb((db) => (db.prepare(`SELECT count(*) AS n FROM memories WHERE nonce IS NOT NULL`).get() as { n: number }).n);
    await lockedAt("baseline_written");
    expect(counts()).toEqual({ chain: 0, manifest: 0 });
    expect(nonceCount()).toBe(0);
    expect(meta()).toMatchObject({ chain_enabled: 0, baseline_seq: null });
    expect(withDb((db) => classify(db)).row).toBe("R1");
  });

  it("R2 (fault between the baseline commit and the clear): stays locked and unlock refuses", async () => {
    const { token } = await lockedAt("baseline_committed");
    expect(meta()).toMatchObject({ chain_enabled: 1, baseline_seq: 1, maintenance_lock_token: token });
    expect(withDb((db) => classify(db)).row).toBe("R2");
    await expectCode(() => unlock(dbPath, { token }, testDeps()), "verifier_required");
    await expectCode(() => unlock(dbPath, { token: "x" }, testDeps()), "token_mismatch");
    await expectCode(baseline(dbPath, testDeps()), "already_baselined");
    expect(meta().maintenance_lock_token).toBe(token);
    // The phase 4 write path refuses while locked.
    const storage = new RekindleStorage(dbPath);
    try {
      expect(() => storage.store("during R2", "general")).toThrow(ProvenanceWriteError);
    } finally {
      storage.close();
    }
  });

  it("the baseline's own clear refuses if the lock was replaced after the commit", async () => {
    preparedStore();
    const deps = testDeps({
      onStep: (s) => {
        if (s === "baseline_committed") {
          withDb((db) => db.prepare(`UPDATE provenance_meta SET maintenance_lock_token = ? WHERE id = 1`).run("c".repeat(32)));
        }
      },
    });
    await expectCode(baseline(dbPath, deps), "lock_lost");
    expect(meta()).toMatchObject({ chain_enabled: 1, maintenance_lock_token: "c".repeat(32) });
  });

  it("the baseline's own clear refuses if only started_at changed after the commit", async () => {
    preparedStore();
    const deps = testDeps({
      onStep: (s) => {
        if (s === "baseline_committed") {
          withDb((db) => db.prepare(`UPDATE provenance_meta SET maintenance_lock_started_at = '2026-10-19 13:00:00' WHERE id = 1`).run());
        }
      },
    });
    await expectCode(baseline(dbPath, deps), "lock_lost");
    expect(meta()).toMatchObject({ chain_enabled: 1, maintenance_lock_started_at: "2026-10-19 13:00:00" });
    expect(meta().maintenance_lock_token).not.toBeNull();
  });

  it("R3: an enabled chain with a broken baseline refuses, locked or not", async () => {
    preparedStore();
    await baseline(dbPath, testDeps());
    withDb((db) => db.prepare(`DELETE FROM provenance_baseline_manifest WHERE ordinal = 0`).run());
    expect(withDb((db) => classify(db)).row).toBe("R3");
    await expectCode(() => unlock(dbPath, { token: "x" }, testDeps()), "manual_recovery");
  });

  it("unclassified: a locked, disabled store with manifest rows stays locked", async () => {
    const { token } = await lockedAt("locked");
    withDb((db) =>
      db.prepare(`INSERT INTO provenance_baseline_manifest (ordinal, kind, target_id, state_hash) VALUES (0, 'memory', 'x', ?)`).run("0".repeat(64)),
    );
    expect(withDb((db) => classify(db)).row).toBe("unclassified");
    await expectCode(() => unlock(dbPath, { token }, testDeps()), "unclassified_state");
    expect(meta().maintenance_lock_token).toBe(token);
  });

  it("an unlocked healthy store with later entries is R0, not R3", async () => {
    preparedStore();
    await baseline(dbPath, testDeps());
    const storage = new RekindleStorage(dbPath);
    storage.store("later", "general");
    storage.close();
    expect(withDb((db) => classify(db)).row).toBe("R0");
  });
});

it("InventoryError is the inventory module's error type", () => {
  expect(new InventoryError("inventory_not_empty", "x")).toBeInstanceOf(Error);
  expect(new MaintenanceError("not_locked", "x").code).toBe("not_locked");
});
