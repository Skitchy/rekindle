import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runSessionStart } from "../../delivery/session-start.js";
import { RekindleStorage } from "../../storage/sqlite.js";
import { CaptureManager } from "../../captures/index.js";
import { createServer } from "../../server.js";
import { DEFAULT_POLICY, loadPolicy } from "../../config/policy.js";
import { readUserCard, resolveUserCardPath } from "../user-card.js";
import { runCardCommand } from "../cli.js";
import { setCardPath } from "../path-config.js";
import { compileCard, CompileRefusal, PartialWriteError, WORKSHEET_WARNING, writeViaTemp } from "../compile.js";

const CARD = "# Test card\n\n## Core\n\n- The synthetic test user likes teal.\n";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rekindle-card-test-"));
  mkdirSync(join(home, ".rekindle", "db"), { recursive: true });
  writeFileSync(join(home, ".rekindle", "identity.md"), "# I am the test identity");
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const env = (extra: Record<string, string> = {}) => ({ REKINDLE_BASE_DIR: home, ...extra });

function packetOf(result: ReturnType<typeof runSessionStart>): string {
  return JSON.parse(result.stdout as string).hookSpecificOutput.additionalContext;
}

function writePolicy(policy: Record<string, unknown>): void {
  writeFileSync(join(home, ".rekindle", "policy.json"), JSON.stringify(policy));
}

function writeCard(name = "user.md", text = CARD): string {
  const path = join(home, name);
  writeFileSync(path, text);
  return path;
}

describe("user card delivery at startup", () => {
  it("adds nothing when no card is configured: same packet, no receipt field", () => {
    const before = runSessionStart({}, env());
    expect(packetOf(before)).not.toContain("## User Card");
    expect("user_card" in before.receipt).toBe(false);
    // Blank env counts as unset, and gives the identical packet.
    const blank = runSessionStart({}, env({ REKINDLE_USER_CARD: "   " }));
    expect(packetOf(blank)).toBe(packetOf(before));
    expect("user_card" in blank.receipt).toBe(false);
  });

  it("delivers a configured card whole, as the first optional section after the required set", () => {
    const card = writeCard();
    const result = runSessionStart({}, env({ REKINDLE_USER_CARD: card }));
    const packet = packetOf(result);
    expect(packet).toContain("## User Card\n\n# Test card");
    expect(packet).toContain("likes teal.");
    expect(packet.indexOf("## User Card")).toBeGreaterThan(packet.indexOf("## Continuity Policy"));
    expect(packet.indexOf("## User Card")).toBeLessThan(packet.indexOf("## Gaps Detected"));
    expect(packet).not.toContain(card); // no absolute path in the packet
    expect(result.receipt.user_card).toEqual({ source: "REKINDLE_USER_CARD", status: "included" });
  });

  it("omits a card too large for the budget, whole, and records it as dropped", () => {
    const withoutCard = packetOf(runSessionStart({}, env()));
    const card = writeCard("big.md", "x".repeat(20000));
    const result = runSessionStart({}, env({ REKINDLE_USER_CARD: card }));
    const packet = packetOf(result);
    expect(packet).not.toContain("## User Card");
    expect(packet).not.toContain("xxxx");
    expect(packet).toBe(withoutCard);
    expect(result.receipt.user_card?.status).toBe("dropped");
  });

  it("with gaps mandatory near the budget, a missing card changes nothing in the packet", () => {
    const policy = {
      ...DEFAULT_POLICY,
      mandatory_sections: ["identity", "project", "checkpoint", "policy", "gaps"],
      optional_sections: ["score", "memories", "transcript"],
      startup_budget_bytes: 1024,
    };
    writePolicy(policy);
    const baseline = runSessionStart({}, env());
    writePolicy({ ...policy, user_card_path: join(home, "no-such-card.md") });
    const result = runSessionStart({}, env());
    expect(packetOf(result)).toBe(packetOf(baseline));
    expect(result.receipt.user_card).toEqual({ source: "policy", status: "missing" });
    expect(result.receipt.error).toBeNull();
  });

  it("reports an unreadable or empty card in the receipt only, and still boots", () => {
    mkdirSync(join(home, "a-directory.md"));
    const unreadable = runSessionStart({}, env({ REKINDLE_USER_CARD: join(home, "a-directory.md") }));
    expect(unreadable.receipt.user_card?.status).toBe("unreadable");
    expect(unreadable.receipt.error).toBeNull();
    expect(packetOf(unreadable)).not.toContain("## User Card");

    const empty = writeCard("empty.md", "  \n");
    const blank = runSessionStart({}, env({ REKINDLE_USER_CARD: empty }));
    expect(blank.receipt.user_card?.status).toBe("empty");
  });

  it("never puts card text or its path in the receipt", () => {
    const card = writeCard();
    const { receipt } = runSessionStart({}, env({ REKINDLE_USER_CARD: card }));
    const text = JSON.stringify(receipt);
    expect(text).not.toContain("teal");
    expect(text).not.toContain(card);
  });
});

describe("card path resolution", () => {
  it("prefers the env var over policy, and treats a blank env var as unset", () => {
    const fromEnv = resolveUserCardPath({ REKINDLE_USER_CARD: "/env/card.md" }, "/policy/card.md", home);
    expect(fromEnv).toEqual({ path: "/env/card.md", source: "REKINDLE_USER_CARD" });
    const blank = resolveUserCardPath({ REKINDLE_USER_CARD: "" }, "/policy/card.md", home);
    expect(blank).toEqual({ path: "/policy/card.md", source: "policy" });
    expect(resolveUserCardPath({}, undefined, home)).toEqual({ path: null, source: "unset" });
  });

  it("resolves a relative policy path against the store root, whatever the cwd", () => {
    writeCard("rel-card.md");
    writePolicy({ ...DEFAULT_POLICY, user_card_path: "../rel-card.md" });
    // The store root is <home>; "../rel-card.md" from <home>/.rekindle would be wrong.
    expect(resolveUserCardPath({}, "rel-card.md", home).path).toBe(join(home, "rel-card.md"));
    writePolicy({ ...DEFAULT_POLICY, user_card_path: "rel-card.md" });
    const a = runSessionStart({ cwd: tmpdir() }, env());
    const b = runSessionStart({ cwd: home }, env());
    const cardOf = (p: string) => p.slice(p.indexOf("## User Card"), p.indexOf("\n\n---\n\n", p.indexOf("## User Card")));
    expect(packetOf(a)).toContain("likes teal.");
    expect(cardOf(packetOf(a))).toBe(cardOf(packetOf(b)));
    expect(a.receipt.user_card).toEqual({ source: "policy", status: "included" });
    expect(b.receipt.user_card).toEqual({ source: "policy", status: "included" });
  });

  it("expands ~ against the home directory", () => {
    expect(resolveUserCardPath({ REKINDLE_USER_CARD: "~/card.md" }, undefined, "/store", "/home/me").path).toBe(
      "/home/me/card.md"
    );
  });

  it("rejects a non-string policy path and a mandatory user section", () => {
    writePolicy({ ...DEFAULT_POLICY, user_card_path: 42 });
    expect(() => loadPolicy(home)).toThrow("user_card_path must be a string");
    expect(packetOf(runSessionStart({}, env()))).toContain("Rekindle Startup Failure");

    writePolicy({ ...DEFAULT_POLICY, mandatory_sections: [...DEFAULT_POLICY.mandatory_sections, "user"] });
    expect(() => loadPolicy(home)).toThrow("the user section is always optional");
  });

  it("still loads a pre-feature policy.json, and still rejects one that omits identity", () => {
    const template = readFileSync(join(__dirname, "..", "..", "init", "templates", "policy.json"), "utf-8");
    writeFileSync(join(home, ".rekindle", "policy.json"), template);
    expect(() => loadPolicy(home)).not.toThrow();
    writePolicy({
      ...DEFAULT_POLICY,
      mandatory_sections: ["project", "checkpoint", "policy"],
    });
    expect(() => loadPolicy(home)).toThrow("sections must be classified");
  });
});

describe("rekindle card path", () => {
  it("changes only user_card_path in an existing policy.json", () => {
    const original = { ...DEFAULT_POLICY, transcript_mode: "excluded", startup_budget_bytes: 6000 };
    writePolicy(original);
    const card = writeCard();
    setCardPath(home, card);
    const after = JSON.parse(readFileSync(join(home, ".rekindle", "policy.json"), "utf-8"));
    const { user_card_path, ...rest } = after;
    expect(rest).toEqual(original);
    expect(user_card_path).toBe(realpathSync(card));

    setCardPath(home, null);
    expect(JSON.parse(readFileSync(join(home, ".rekindle", "policy.json"), "utf-8"))).toEqual(original);
  });

  it("refuses a card file that does not exist, and leaves policy.json alone", () => {
    writePolicy(DEFAULT_POLICY as unknown as Record<string, unknown>);
    const before = readFileSync(join(home, ".rekindle", "policy.json"), "utf-8");
    expect(() => setCardPath(home, join(home, "nope.md"))).toThrow("No file at");
    expect(readFileSync(join(home, ".rekindle", "policy.json"), "utf-8")).toBe(before);
  });
});

describe("boot_report", () => {
  it("includes the configured card, read from the server's store root", async () => {
    const card = writeCard();
    const storage = new RekindleStorage(join(home, ".rekindle", "db", "memories.db"));
    const server = createServer(storage, new CaptureManager(home), home, { REKINDLE_USER_CARD: card });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const res = await client.callTool({
        name: "boot_report",
        arguments: { identity_path: join(home, ".rekindle", "identity.md"), transcript_dir: join(home, "none") },
      });
      const text = (res.content as Array<{ text: string }>)[0].text;
      expect(text).toContain("## User Card\n\n# Test card");
      expect(text.indexOf("## User Card")).toBeGreaterThan(text.indexOf("## Identity"));
      expect(text).not.toContain(card);
    } finally {
      await client.close();
      storage.close();
    }
  });

  it("is unchanged when no store root is given", async () => {
    const storage = new RekindleStorage(join(home, ".rekindle", "db", "memories.db"));
    const server = createServer(storage, new CaptureManager(home), undefined, { REKINDLE_USER_CARD: writeCard() });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const res = await client.callTool({
        name: "boot_report",
        arguments: { identity_path: join(home, ".rekindle", "identity.md"), transcript_dir: join(home, "none") },
      });
      expect((res.content as Array<{ text: string }>)[0].text).not.toContain("## User Card");
    } finally {
      await client.close();
      storage.close();
    }
  });
});

describe("rekindle card compile", () => {
  let storage: RekindleStorage;
  let dbPath: string;
  let out: string;
  const identityPath = () => join(home, ".rekindle", "identity.md");

  beforeEach(() => {
    dbPath = join(home, ".rekindle", "db", "memories.db");
    storage = new RekindleStorage(dbPath);
    out = join(home, "out");
    mkdirSync(out);
  });

  afterEach(() => {
    storage.close();
  });

  const run = (extra: Partial<Parameters<typeof compileCard>[0]> = {}) =>
    compileCard({
      storage,
      protectedPaths: [dbPath],
      identityPath: identityPath(),
      includeProjects: [],
      fromFiles: [],
      outDir: out,
      now: new Date("2026-10-28T12:00:00Z"),
      ...extra,
    });

  it("by default takes only project-less preferences and constraints, plus the identity section", () => {
    const pref = storage.store("Prefers short answers.", "preference", 6, undefined, { type: "preference" });
    storage.store("Never push without asking.", "lesson", 9, undefined, { type: "constraint" });
    storage.store("Project-only preference.", "preference", 6, "secret-project", { type: "preference" });
    storage.store("An unrelated lesson.", "lesson", 5);
    writeFileSync(
      identityPath(),
      "# Identity\n\n## What I Know About My Person\n<!-- template comment -->\nWorks night shifts.\n\n## Active Context\nNot this.\n"
    );
    run();
    const draft = readFileSync(join(out, "card-draft.md"), "utf-8");
    const sheet = readFileSync(join(out, "card-worksheet.md"), "utf-8");
    expect(draft).toContain("- Prefers short answers.");
    expect(draft).toContain("## Boundaries\n\n- Never push without asking.");
    expect(draft).toContain("Works night shifts.");
    expect(draft).not.toContain("template comment");
    expect(draft).not.toContain("Not this.");
    expect(draft).not.toContain("Project-only preference.");
    expect(draft).not.toContain("An unrelated lesson.");
    expect(draft).not.toContain(pref);
    expect(sheet).toContain(pref);
    expect(sheet).toContain("Project records not included (add --include-project <name>): secret-project.");
  });

  it("includes named projects, dated, under a confirm-each heading", () => {
    storage.store("Ship 0.5 before December.", "preference", 6, "rekindle", { type: "preference" });
    run({ includeProjects: ["rekindle"] });
    const draft = readFileSync(join(out, "card-draft.md"), "utf-8");
    expect(draft).toContain("## Current projects (confirm each is still active)\n\n### rekindle\n\n- Ship 0.5 before December.");
  });

  it("pages past 50 records with ties on created_at, with no duplicates or gaps, and reports the cap", () => {
    for (let i = 0; i < 120; i++) storage.store(`Preference number ${i}.`, "preference", 6, undefined, { type: "preference" });
    const db = new Database(dbPath);
    db.prepare(`UPDATE memories SET created_at = '2026-10-01 00:00:00'`).run();
    db.close();
    const all = storage.listCardSources({ includeProjectless: true, projects: [], cap: 2000, pageSize: 7 });
    expect(all.rows.length).toBe(120);
    expect(new Set(all.rows.map((r) => r.id)).size).toBe(120);
    expect(all.capped).toBe(false);
    const capped = storage.listCardSources({ includeProjectless: true, projects: [], cap: 100, pageSize: 7 });
    expect(capped.rows.length).toBe(100);
    expect(capped.capped).toBe(true);
    run({ cap: 100 });
    expect(readFileSync(join(out, "card-worksheet.md"), "utf-8")).toContain("beyond the 100-record cap");
  });

  it("collapses exact duplicates, marks stale entries, and carries the incomplete-detection warning", () => {
    storage.store("Likes  teal.", "preference", 6, undefined, { type: "preference" });
    storage.store("Likes teal.", "preference", 6, undefined, { type: "preference" });
    const old = storage.store("Uses Windows.", "preference", 6, undefined, { type: "preference" });
    const db = new Database(dbPath);
    db.prepare(`UPDATE memories SET created_at = '2025-01-01 00:00:00' WHERE id = ?`).run(old);
    db.close();
    run();
    const draft = readFileSync(join(out, "card-draft.md"), "utf-8");
    const sheet = readFileSync(join(out, "card-worksheet.md"), "utf-8");
    expect(draft.match(/Likes teal\./g)?.length).toBe(1);
    expect(sheet).toContain("duplicate of");
    expect(sheet).toContain("check: may be stale");
    expect(sheet).toContain(WORKSHEET_WARNING);
    expect(draft).toContain(WORKSHEET_WARNING);
  });

  it("never changes the reviewed card, however many times it runs", () => {
    const card = writeCard();
    const before = readFileSync(card);
    storage.store("Prefers short answers.", "preference", 6, undefined, { type: "preference" });
    run({ protectedPaths: [dbPath, card] });
    run({ protectedPaths: [dbPath, card] });
    expect(readFileSync(card).equals(before)).toBe(true);
  });

  it("refuses a symlinked or hardlinked output, or outputs that alias each other, and writes nothing", () => {
    const card = writeCard();
    symlinkSync(card, join(out, "card-draft.md"));
    expect(() => run({ protectedPaths: [dbPath, card] })).toThrow(CompileRefusal);
    expect(existsSync(join(out, "card-worksheet.md"))).toBe(false);
    rmSync(join(out, "card-draft.md"));

    linkSync(card, join(out, "card-draft.md"));
    expect(() => run({ protectedPaths: [dbPath, card] })).toThrow(CompileRefusal);
    expect(readFileSync(card, "utf-8")).toBe(CARD);
    rmSync(join(out, "card-draft.md"));

    writeFileSync(join(out, "card-draft.md"), "old draft");
    linkSync(join(out, "card-draft.md"), join(out, "card-worksheet.md"));
    expect(() => run()).toThrow(CompileRefusal);
    expect(readFileSync(join(out, "card-draft.md"), "utf-8")).toBe("old draft");

    // A card that happens to sit at the output path is refused, whether or not it exists yet.
    expect(() => run({ outDir: home, protectedPaths: [dbPath, join(home, "card-draft.md")] })).toThrow(CompileRefusal);
    writeFileSync(join(home, "card-draft.md"), CARD);
    expect(() => run({ outDir: home, protectedPaths: [dbPath, join(home, "card-draft.md")] })).toThrow(CompileRefusal);
    expect(readFileSync(join(home, "card-draft.md"), "utf-8")).toBe(CARD);
  });

  it("reports a partial write when the second output fails", () => {
    mkdirSync(join(out, "card-worksheet.md"));
    let caught: unknown;
    try {
      run();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PartialWriteError);
    expect((caught as PartialWriteError).completed).toEqual([join(out, "card-draft.md")]);
    expect(existsSync(join(out, "card-draft.md"))).toBe(true);
  });

  it("writes both outputs private to the user", () => {
    run();
    expect(statSync(join(out, "card-draft.md")).mode & 0o777).toBe(0o600);
    expect(statSync(join(out, "card-worksheet.md")).mode & 0o777).toBe(0o600);
  });

  it("labels imported files and lists the ones it could not read", () => {
    const notes = join(home, "ari-notes.md");
    writeFileSync(notes, "- From Ari: prefers evidence over assurances.");
    const unreadable = join(home, "locked.md");
    writeFileSync(unreadable, "LOCKED-CONTENT");
    chmodSync(unreadable, 0o000);
    run({ fromFiles: [notes, unreadable] });
    chmodSync(unreadable, 0o600);
    const draft = readFileSync(join(out, "card-draft.md"), "utf-8");
    const sheet = readFileSync(join(out, "card-worksheet.md"), "utf-8");
    expect(draft).toContain("## Imported: ari-notes.md\n\n- From Ari: prefers evidence over assurances.");
    expect(sheet).toContain("- Imported file: ari-notes.md");
    expect(sheet).toContain("--from locked.md could not be read.");
    expect(draft).not.toContain("LOCKED-CONTENT");
  });

  it("reads only its own store and the files it is given", () => {
    writeFileSync(join(out, "decoy.md"), "DECOY CONTENT");
    writeFileSync(join(home, "decoy.md"), "DECOY CONTENT");
    run();
    expect(readFileSync(join(out, "card-draft.md"), "utf-8")).not.toContain("DECOY");
    expect(readFileSync(join(out, "card-worksheet.md"), "utf-8")).not.toContain("DECOY");
  });
});

describe("fixes from Ari's code review (room 613)", () => {
  it("compile protects the card the env var shadows, not only the effective one", () => {
    const out = join(home, "out");
    mkdirSync(out);
    const savedCard = join(out, "card-draft.md");
    writeFileSync(savedCard, CARD);
    writePolicy({ ...DEFAULT_POLICY, user_card_path: savedCard });
    const other = writeCard("other.md");
    const code = runCardCommand(["compile", "--out", out], env({ REKINDLE_USER_CARD: other }));
    expect(code).toBe(1);
    expect(readFileSync(savedCard, "utf-8")).toBe(CARD);
    expect(existsSync(join(out, "card-worksheet.md"))).toBe(false);
  });

  it("compile fails closed on an unreadable or invalid policy, and writes nothing", () => {
    const out = join(home, "out");
    mkdirSync(out);
    const savedCard = join(out, "card-draft.md");
    writeFileSync(savedCard, CARD);
    for (const bad of ["{ not json", JSON.stringify({ ...DEFAULT_POLICY, startup_budget_bytes: 3, user_card_path: savedCard })]) {
      writeFileSync(join(home, ".rekindle", "policy.json"), bad);
      expect(runCardCommand(["compile", "--out", out], env())).toBe(1);
      expect(readFileSync(savedCard, "utf-8")).toBe(CARD);
      expect(existsSync(join(out, "card-worksheet.md"))).toBe(false);
    }
  });

  it("a failed policy write leaves the old policy.json byte-for-byte intact, with no temp left behind", () => {
    writePolicy({ ...DEFAULT_POLICY, transcript_mode: "excluded" });
    const before = readFileSync(join(home, ".rekindle", "policy.json"));
    const card = writeCard();
    const dir = join(home, ".rekindle");
    chmodSync(dir, 0o500); // the file stays writable; only creating a temp file fails
    try {
      expect(() => setCardPath(home, card)).toThrow();
    } finally {
      chmodSync(dir, 0o755);
    }
    expect(readFileSync(join(dir, "policy.json")).equals(before)).toBe(true);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("never blocks on a FIFO, and refuses non-regular or blank paths at setup", () => {
    const fifo = join(home, "card.fifo");
    execFileSync("mkfifo", [fifo]);
    const started = Date.now();
    expect(readUserCard(fifo, "policy").status).toBe("unreadable");
    const boot = runSessionStart({}, env({ REKINDLE_USER_CARD: fifo }));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(boot.receipt.user_card?.status).toBe("unreadable");
    expect(boot.receipt.error).toBeNull();

    expect(() => setCardPath(home, fifo)).toThrow("not a regular file");
    expect(() => setCardPath(home, home)).toThrow("not a regular file");
    expect(() => setCardPath(home, "")).toThrow("No card file given");
    expect(() => setCardPath(home, "   ")).toThrow("No card file given");
  });

  it("does not read a card larger than the budget; it is reported as dropped", () => {
    const big = writeCard("huge.md", "y".repeat(9000));
    expect(readUserCard(big, "policy", 8000).status).toBe("too_large");
    const result = runSessionStart({}, env({ REKINDLE_USER_CARD: big }));
    expect(result.receipt.user_card?.status).toBe("dropped");
    expect(packetOf(result)).not.toContain("yyyy");
  });

  it("keeps each project entry's recorded date in the draft itself", () => {
    const dbPath = join(home, ".rekindle", "db", "memories.db");
    const storage = new RekindleStorage(dbPath);
    try {
      const id = storage.store("Ship 0.5 before December.", "preference", 6, "rekindle", { type: "preference" });
      const db = new Database(dbPath);
      db.prepare(`UPDATE memories SET created_at = '2026-10-01 09:30:00' WHERE id = ?`).run(id);
      db.close();
      const out = join(home, "out");
      mkdirSync(out);
      compileCard({ storage, protectedPaths: [dbPath], identityPath: join(home, ".rekindle", "identity.md"), includeProjects: ["rekindle"], fromFiles: [], outDir: out });
      const draft = readFileSync(join(out, "card-draft.md"), "utf-8");
      expect(draft).toContain("## Current projects (confirm each is still active)");
      expect(draft).toContain("- Ship 0.5 before December. (recorded 2026-10-01)");
    } finally {
      storage.close();
    }
  });
});

describe("temp-file ownership (Ari's recheck, room 623)", () => {
  it("never removes a pre-existing file at the temp name when exclusive creation fails", () => {
    const target = join(home, "target.md");
    writeFileSync(target, "original");
    const squatter = join(home, ".target.md.fixed.tmp");
    writeFileSync(squatter, "someone else's file");
    expect(() => writeViaTemp(target, "new", 0o600, () => "fixed")).toThrow(/EEXIST/);
    expect(readFileSync(squatter, "utf-8")).toBe("someone else's file");
    expect(readFileSync(target, "utf-8")).toBe("original");
  });

  it("removes its own temp when a later step fails", () => {
    const target = join(home, "a-dir");
    mkdirSync(target);
    writeFileSync(join(target, "keep"), "x"); // a non-empty directory: rename over it fails
    expect(() => writeViaTemp(target, "new", 0o600, () => "mine")).toThrow();
    expect(existsSync(join(home, ".a-dir.mine.tmp"))).toBe(false);
    expect(readFileSync(join(target, "keep"), "utf-8")).toBe("x");
  });
});

describe("complete writes (Ari's commit review, room 628)", () => {
  it("finishes the file across short writes", () => {
    const target = join(home, "short.md");
    writeFileSync(target, "original");
    const text = "x".repeat(1000) + "end";
    const threeAtATime = (fd: number, buf: Buffer, off: number, len: number) => writeSync(fd, buf, off, Math.min(3, len));
    writeViaTemp(target, text, 0o600, undefined, threeAtATime);
    expect(readFileSync(target, "utf-8")).toBe(text);
  });

  it("keeps the original and removes its temp when a write fails partway", () => {
    const target = join(home, "partial.md");
    writeFileSync(target, "original");
    let calls = 0;
    const failSecond = (fd: number, buf: Buffer, off: number, len: number) => {
      calls += 1;
      if (calls === 1) return writeSync(fd, buf, off, Math.min(10, len));
      throw Object.assign(new Error("EFBIG: file too large"), { code: "EFBIG" });
    };
    expect(() => writeViaTemp(target, "y".repeat(100), 0o600, () => "partial", failSecond)).toThrow(/EFBIG/);
    expect(readFileSync(target, "utf-8")).toBe("original");
    expect(existsSync(join(home, ".partial.md.partial.tmp"))).toBe(false);
  });

  it("treats a zero-byte write as failure, never as done", () => {
    const target = join(home, "stall.md");
    writeFileSync(target, "original");
    expect(() => writeViaTemp(target, "data", 0o600, () => "stall", () => 0)).toThrow(/write stalled after 0 of 4 bytes/);
    expect(readFileSync(target, "utf-8")).toBe("original");
    expect(existsSync(join(home, ".stall.md.stall.tmp"))).toBe(false);
  });
});
