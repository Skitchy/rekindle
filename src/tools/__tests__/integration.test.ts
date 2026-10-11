import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { RekindleStorage } from "../../storage/sqlite.js";
import { prepareWriteContext, keyFromSeed, keyIdOf, TEST_SEED_ENV } from "../../provenance/keys.js";
import {
  MERKLE_SPEC,
  entryHash,
  jcs,
  merkleRoot,
  sortMerkleLeaves,
  stateHash,
  type MerkleLeaf,
} from "../../provenance/canonical.js";
import { signEntryHash } from "../../provenance/chain.js";
import { createHash, verify } from "node:crypto";
import { CaptureManager } from "../../captures/index.js";
import { createServer } from "../../server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { REKINDLE_VERSION } from "../../version.js";
import Database from "better-sqlite3";

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

beforeAll(() => {
  expect(vi.isMockFunction(execFileSync)).toBe(true);
  expect(vi.isMockFunction(prepareWriteContext)).toBe(true);
});

let storage: RekindleStorage;
let client: Client;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "rekindle-integration-"));
  storage = new RekindleStorage(join(tmpDir, "db", "memories.db"));
  const captureManager = new CaptureManager(tmpDir);

  const server = createServer(storage, captureManager);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  client = new Client({ name: "test-client", version: "1.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
});

afterEach(() => {
  storage.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("MCP server integration", () => {
  it("reports the version from package metadata", () => {
    expect(client.getServerVersion()).toEqual({
      name: "rekindle",
      version: REKINDLE_VERSION,
    });
  });

  it("lists 10 tools", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "boot_report",
      "capture_now",
      "delete_memory",
      "end_session",
      "list_captures",
      "list_memories",
      "read_capture",
      "search_memory",
      "store_memory",
      "update_memory",
    ]);
  });

  it("stores and retrieves a memory", async () => {
    const storeResult = await client.callTool({
      name: "store_memory",
      arguments: {
        content: "Skitch prefers dark mode",
        category: "preference",
        importance: 8,
        project: "rekindle",
      },
    });

    const storeData = JSON.parse(
      (storeResult.content as { type: string; text: string }[])[0].text
    );
    expect(storeData.id).toBeTruthy();
    expect(storeData.message).toBe("Memory stored");

    const searchResult = await client.callTool({
      name: "search_memory",
      arguments: { query: "dark mode", limit: 5 },
    });

    const searchData = JSON.parse(
      (searchResult.content as { type: string; text: string }[])[0].text
    );
    expect(searchData.count).toBe(1);
    expect(searchData.results[0].content).toBe("Skitch prefers dark mode");
    expect(searchData.results[0].category).toBe("preference");
  });

  it("lists memories filtered by project", async () => {
    await client.callTool({
      name: "store_memory",
      arguments: { content: "Rekindle note", project: "rekindle" },
    });
    await client.callTool({
      name: "store_memory",
      arguments: { content: "Other note", project: "other" },
    });

    const listResult = await client.callTool({
      name: "list_memories",
      arguments: { project: "rekindle" },
    });

    const data = JSON.parse(
      (listResult.content as { type: string; text: string }[])[0].text
    );
    expect(data.count).toBe(1);
    expect(data.memories[0].content).toBe("Rekindle note");
  });

  it("updates a memory", async () => {
    const storeResult = await client.callTool({
      name: "store_memory",
      arguments: { content: "Original", importance: 3 },
    });
    const { id } = JSON.parse(
      (storeResult.content as { type: string; text: string }[])[0].text
    );

    const updateResult = await client.callTool({
      name: "update_memory",
      arguments: { id, content: "Updated", importance: 9 },
    });

    const data = JSON.parse(
      (updateResult.content as { type: string; text: string }[])[0].text
    );
    expect(data.success).toBe(true);
    expect(data.memory.content).toBe("Updated");
    expect(data.memory.importance).toBe(9);
  });

  it("deletes a memory", async () => {
    const storeResult = await client.callTool({
      name: "store_memory",
      arguments: { content: "To delete" },
    });
    const { id } = JSON.parse(
      (storeResult.content as { type: string; text: string }[])[0].text
    );

    const deleteResult = await client.callTool({
      name: "delete_memory",
      arguments: { id },
    });

    const data = JSON.parse(
      (deleteResult.content as { type: string; text: string }[])[0].text
    );
    expect(data.success).toBe(true);

    const listResult = await client.callTool({
      name: "list_memories",
      arguments: {},
    });
    const listData = JSON.parse(
      (listResult.content as { type: string; text: string }[])[0].text
    );
    expect(listData.count).toBe(0);
  });

  it("generates boot report with gaps", async () => {
    const identityPath = join(tmpDir, "identity.md");
    const transcriptDir = join(tmpDir, "transcripts");
    mkdirSync(transcriptDir);

    writeFileSync(
      identityPath,
      "# Identity\n\n## Voice\nDirect, no fluff.\n\n## What Matters\nContinuity."
    );

    writeFileSync(
      join(transcriptDir, "session-2026-05-05-120000.md"),
      "# Session Transcript\n\nHuman: Let's work on the storage layer.\n\nAssistant: Starting Phase 2."
    );

    await client.callTool({
      name: "store_memory",
      arguments: {
        content: "Session checkpoint: built storage adapter",
        category: "context",
        importance: 7,
        project: "rekindle",
      },
    });

    const bootResult = await client.callTool({
      name: "boot_report",
      arguments: {
        identity_path: identityPath,
        transcript_dir: transcriptDir,
      },
    });

    const report = (
      bootResult.content as { type: string; text: string }[]
    )[0].text;

    expect(report).toContain("## Identity");
    expect(report).toContain("Direct, no fluff");
    expect(report).toContain("## Memories");
    expect(report).toContain("1 total");
    expect(report).toContain("## Last Checkpoint");
    expect(report).toContain("built storage adapter");
    expect(report).toContain("## Last Session Transcript");
    expect(report).toContain("storage layer");
    expect(report).toContain("## Gaps Detected");
    expect(report).toContain("No preference memories");
  });

  it("boot report handles empty state gracefully", async () => {
    const bootResult = await client.callTool({
      name: "boot_report",
      arguments: {
        identity_path: join(tmpDir, "nonexistent.md"),
        transcript_dir: join(tmpDir, "nonexistent"),
      },
    });

    const report = (
      bootResult.content as { type: string; text: string }[]
    )[0].text;

    expect(report).toContain("Not found");
    expect(report).toContain("0 total");
    expect(report).toContain("None found");
    expect(report).toContain("No transcripts found");
    expect(report).toContain("No identity document found");
  });

  it("boot report includes orientation score", async () => {
    const bootResult = await client.callTool({
      name: "boot_report",
      arguments: {
        identity_path: join(tmpDir, "nonexistent.md"),
        transcript_dir: join(tmpDir, "nonexistent"),
      },
    });

    const report = (
      bootResult.content as { type: string; text: string }[]
    )[0].text;

    expect(report).toContain("## Orientation Score");
    expect(report).toContain("/100");
    expect(report).toContain("structural checklist");
  });

  it("end_session stores checkpoint and returns confirmation", async () => {
    const result = await client.callTool({
      name: "end_session",
      arguments: {
        checkpoint: "Finished implementing the orientation layer",
      },
    });

    const data = JSON.parse(
      (result.content as { type: string; text: string }[])[0].text
    );

    expect(data.session_id).toBeDefined();
    expect(data.stored_count).toBe(1);
    expect(data.stored.checkpoint).toBe(1);
    expect(data.message).toContain("Session captured");
  });

  it("fails end_session before any row is written when provenance is required", async () => {
    const requiredStorage = new RekindleStorage(join(tmpDir, "required", "memories.db"), true);
    const requiredServer = createServer(requiredStorage, new CaptureManager(tmpDir));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const requiredClient = new Client({ name: "required-test", version: "1.0" });
    await Promise.all([requiredClient.connect(clientTransport), requiredServer.connect(serverTransport)]);
    const result = await requiredClient.callTool({
      name: "end_session",
      arguments: { checkpoint: "must not persist" },
    });
    expect(result.isError).toBe(true);
    expect(requiredStorage.sessionCount()).toBe(0);
    expect(requiredStorage.list()).toHaveLength(0);
    expect(requiredStorage.listSessionWriteAudit()).toHaveLength(0);
    await requiredClient.close();
    await requiredServer.close();
    requiredStorage.close();
  });

  it("end_session stores full payload", async () => {
    const result = await client.callTool({
      name: "end_session",
      arguments: {
        checkpoint: "Completed v0.2 architecture",
        decisions: ["Use type column instead of content prefixes", "Add relational_delta"],
        open_loops: ["Windows testing", "npm publish"],
        preferences: ["User prefers single-line commands"],
        constraints: ["Do not frame as consciousness proof"],
        warnings: ["Boot report format changed slightly"],
        relational_delta: "Trust strengthened through collaborative architecture review",
        next_session_focus: "Write new tests for orientation layer",
        project: "rekindle",
      },
    });

    const data = JSON.parse(
      (result.content as { type: string; text: string }[])[0].text
    );

    expect(data.stored_count).toBe(10);
    expect(data.stored.checkpoint).toBe(1);
    expect(data.stored.decision).toBe(2);
    expect(data.stored.open_loop).toBe(2);
    expect(data.stored.preference).toBe(1);
    expect(data.stored.constraint).toBe(1);
    expect(data.stored.warning).toBe(1);
    expect(data.stored.relational_delta).toBe(1);
    expect(data.stored.next_session_focus).toBe(1);
  });

  it("end_session records are retrievable via list", async () => {
    await client.callTool({
      name: "end_session",
      arguments: {
        checkpoint: "Test checkpoint for retrieval",
        project: "test-project",
      },
    });

    const listResult = await client.callTool({
      name: "list_memories",
      arguments: { category: "context", project: "test-project" },
    });

    const data = JSON.parse(
      (listResult.content as { type: string; text: string }[])[0].text
    );

    expect(data.memories.length).toBeGreaterThanOrEqual(1);
    expect(data.memories.some((m: { content: string }) => m.content === "Test checkpoint for retrieval")).toBe(true);
  });

  it("end_session checkpoint appears in boot_report", async () => {
    await client.callTool({
      name: "end_session",
      arguments: {
        checkpoint: "Left off at boot report integration",
      },
    });

    const bootResult = await client.callTool({
      name: "boot_report",
      arguments: {
        identity_path: join(tmpDir, "nonexistent.md"),
        transcript_dir: join(tmpDir, "nonexistent"),
      },
    });

    const report = (
      bootResult.content as { type: string; text: string }[]
    )[0].text;

    expect(report).toContain("Left off at boot report integration");
  });
});

// Phase 0 through the real end_session tool: if any session write or its
// audit row fails, the whole end_session (session, checkpoint, decisions)
// rolls back. Cases 6 and 8 fail the updateSession call end_session makes
// after storing its records, so earlier writes in the batch must roll back too.
describe("end_session write atomicity", () => {
  const AUTHORITATIVE = ["sessions", "session_write_audit", "memories", "memory_write_audit"];
  const dbPath = () => join(tmpDir, "db", "memories.db");

  function snapshot(): Record<string, unknown[]> {
    const reader = new Database(dbPath(), { readonly: true, fileMustExist: true });
    try {
      return Object.fromEntries(
        AUTHORITATIVE.map((t) => [t, reader.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])
      );
    } finally {
      reader.close();
    }
  }

  function injectFailure(trigger: string): void {
    const injector = new Database(dbPath(), { fileMustExist: true });
    try {
      injector.exec(trigger);
    } finally {
      injector.close();
    }
  }

  async function endSessionMustFail(): Promise<void> {
    const result = await client.callTool({
      name: "end_session",
      arguments: { checkpoint: "must not persist", decisions: ["nor this decision"], project: "rekindle" },
    });
    expect(result.isError).toBe(true);
    expect((result.content as { type: string; text: string }[])[0].text).toContain("injected");
  }

  beforeEach(() => {
    storage.store("pre-existing memory", "context", 5, "rekindle");
    storage.createSession({ summary: "pre-existing session", project: "rekindle" });
  });

  it("case 2: end_session rolls back when the createSession audit insert fails", async () => {
    const before = snapshot();
    injectFailure(`CREATE TRIGGER inj BEFORE INSERT ON session_write_audit
      WHEN NEW.action = 'create' BEGIN SELECT RAISE(ABORT, 'injected'); END`);
    await endSessionMustFail();
    expect(snapshot()).toEqual(before);
  });

  it("case 4: end_session rolls back when the session insert fails", async () => {
    const before = snapshot();
    injectFailure(`CREATE TRIGGER inj BEFORE INSERT ON sessions
      BEGIN SELECT RAISE(ABORT, 'injected'); END`);
    await endSessionMustFail();
    expect(snapshot()).toEqual(before);
  });

  it("case 6: end_session rolls back everything when its updateSession audit insert fails", async () => {
    const before = snapshot();
    injectFailure(`CREATE TRIGGER inj BEFORE INSERT ON session_write_audit
      WHEN NEW.action = 'update' BEGIN SELECT RAISE(ABORT, 'injected'); END`);
    await endSessionMustFail();
    expect(snapshot()).toEqual(before);
  });

  it("case 8: end_session rolls back everything when its session update fails", async () => {
    const before = snapshot();
    injectFailure(`CREATE TRIGGER inj BEFORE UPDATE ON sessions
      BEGIN SELECT RAISE(ABORT, 'injected'); END`);
    await endSessionMustFail();
    expect(snapshot()).toEqual(before);
  });
});

// Phase 3 through the real end_session tool: the whole batch goes through one semanticWrite.
describe("end_session semantic write gate", () => {
  const AUTHORITATIVE = [
    "sessions",
    "session_write_audit",
    "memories",
    "memory_write_audit",
    "provenance_chain",
    "provenance_baseline_manifest",
  ];
  const dbPath = () => join(tmpDir, "db", "memories.db");
  const STORE_ID = "0123456789abcdef0123456789abcdef";
  let savedSeed: string | undefined;

  function withConnection<T>(fn: (db: Database.Database) => T, readonly = false): T {
    const db = new Database(dbPath(), { readonly, fileMustExist: true });
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  const snapshot = (): Record<string, unknown[]> =>
    withConnection(
      (db) => Object.fromEntries(AUTHORITATIVE.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])),
      true,
    );

  async function endSession() {
    const result = await client.callTool({
      name: "end_session",
      arguments: { checkpoint: "must not persist", decisions: ["nor this decision"], project: "rekindle" },
    });
    return { isError: result.isError, text: (result.content as { type: string; text: string }[])[0].text };
  }

  beforeEach(() => {
    storage.store("pre-existing memory", "context", 5, "rekindle");
    storage.createSession({ summary: "pre-existing session", project: "rekindle" });
    vi.mocked(prepareWriteContext).mockClear();
    vi.mocked(execFileSync).mockClear();
    savedSeed = process.env[TEST_SEED_ENV];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedSeed === undefined) delete process.env[TEST_SEED_ENV];
    else process.env[TEST_SEED_ENV] = savedSeed;
  });

  it("is refused under a maintenance lock set from another connection, leaving no partial rows", async () => {
    withConnection((db) =>
      db.prepare(
        `UPDATE provenance_meta SET maintenance_lock_token = 'token', maintenance_lock_started_at = 'now' WHERE id = 1`,
      ).run(),
    );
    const before = snapshot();
    const result = await endSession();
    expect(result.isError).toBe(true);
    expect(result.text).toContain("maintenance_locked");
    expect(snapshot()).toEqual(before);
    expect(prepareWriteContext).not.toHaveBeenCalled();
  });

  it("hint 0, flag flipped, then lock: one prepare, one retry, then one signed entry per semantic write event", async () => {
    const seed = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
    process.env[TEST_SEED_ENV] = seed;
    const key = keyFromSeed(Buffer.from(seed, "hex"));
    const keyId = keyIdOf(key);
    // Phase 4 test-fixture convention only, not a settled Phase 5 payload/manifest-hash contract
    // (Phase 5 may revise it). Models a baseline over the describe's pre-existing memory and
    // session: each gets a nonce and a manifest leaf, and the signed payload binds root and hash.
    const seedValidChain = (db: Database.Database) => {
      const leaves: MerkleLeaf[] = [];
      for (const [kind, table] of [["memory", "memories"], ["session", "sessions"]] as const) {
        for (const row of db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]) {
          const nonce = createHash("sha256").update(`fixture-nonce:${kind}:${row.id as string}`).digest();
          db.prepare(`UPDATE ${table} SET nonce = ? WHERE id = ?`).run(nonce, row.id);
          const live = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id) as Record<string, unknown>;
          leaves.push({ kind, target_id: row.id as string, state_hash: stateHash(kind, nonce, live) });
        }
      }
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
    const target = RekindleStorage.prototype as unknown as { readChainEnabledHint(this: RekindleStorage): boolean };
    const realHint = target.readChainEnabledHint;
    const hint = vi.spyOn(target, "readChainEnabledHint").mockImplementation(function (this: RekindleStorage) {
      const stale = realHint.call(this);
      withConnection(seedValidChain);
      return stale;
    });

    const result = await endSession();

    expect(result.isError).toBeFalsy();
    const sessionId = JSON.parse(result.text).session_id as string;
    expect(hint).toHaveBeenCalledTimes(1);
    expect(prepareWriteContext).toHaveBeenCalledTimes(1);
    expect(execFileSync).not.toHaveBeenCalled();
    // One entry per semantic write event in the batch: session create, checkpoint store,
    // decision store, then the session update, each linked to the entry before it.
    const chain = snapshot().provenance_chain as Record<string, unknown>[];
    expect(chain.map((r) => [r.seq, r.audit_kind, r.action])).toEqual([
      [1, "baseline", "baseline"],
      [2, "session", "create"],
      [3, "memory", "store"],
      [4, "memory", "store"],
      [5, "session", "update"],
    ]);
    expect(chain[1].target_id).toBe(sessionId);
    expect(chain[4].target_id).toBe(sessionId);
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].prev_hash).toBe(chain[i - 1].entry_hash);
      expect(chain[i].key_id).toBe(keyId);
      expect(
        verify(null, Buffer.from(chain[i].entry_hash as string, "hex"), key, Buffer.from(chain[i].signature as string, "hex")),
      ).toBe(true);
    }
    // The fixture is a complete baseline over the pre-existing memory and session, and they are untouched.
    const manifest = withConnection(
      (db) => db.prepare(`SELECT kind, target_id, state_hash FROM provenance_baseline_manifest ORDER BY ordinal`).all() as MerkleLeaf[],
      true,
    );
    expect(manifest.map((l) => l.kind).sort()).toEqual(["memory", "session"]);
    for (const leaf of manifest) {
      const table = leaf.kind === "memory" ? "memories" : "sessions";
      const live = withConnection(
        (db) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(leaf.target_id) as Record<string, unknown>,
        true,
      );
      expect(stateHash(leaf.kind, live.nonce as Buffer, live)).toBe(leaf.state_hash);
    }
    expect(JSON.parse(chain[0].meta_payload as string)).toMatchObject({
      leaf_count: 2,
      root: merkleRoot(manifest),
      // The payload binds exactly the persisted manifest.
      manifest_hash: createHash("sha256").update(jcs(manifest.map((l) => [l.kind, l.target_id, l.state_hash]))).digest("hex"),
    });
  });
});
