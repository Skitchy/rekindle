import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RekindleStorage } from "../sqlite.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let storage: RekindleStorage;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "rekindle-test-"));
  storage = new RekindleStorage(join(tmpDir, "db", "memories.db"));
});

afterEach(() => {
  storage.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("store", () => {
  it("stores a memory and returns an id", () => {
    const id = storage.store("Test memory content");
    expect(id).toMatch(/^[a-f0-9]{32}$/);
  });

  it("stores with all fields", () => {
    const id = storage.store("Important lesson", "lesson", 8, "rekindle");
    const mem = storage.get(id);
    expect(mem).not.toBeNull();
    expect(mem!.content).toBe("Important lesson");
    expect(mem!.category).toBe("lesson");
    expect(mem!.importance).toBe(8);
    expect(mem!.project).toBe("rekindle");
  });

  it("clamps importance to 1-10", () => {
    const id1 = storage.store("Low", "general", 0);
    const id2 = storage.store("High", "general", 15);
    expect(storage.get(id1)!.importance).toBe(1);
    expect(storage.get(id2)!.importance).toBe(10);
  });

  it("defaults category to general and importance to 5", () => {
    const id = storage.store("Default memory");
    const mem = storage.get(id);
    expect(mem!.category).toBe("general");
    expect(mem!.importance).toBe(5);
  });
});

describe("get", () => {
  it("returns null for nonexistent id", () => {
    expect(storage.get("nonexistent")).toBeNull();
  });
});

describe("search", () => {
  it("finds memories by content", () => {
    storage.store("TypeScript is a typed superset of JavaScript");
    storage.store("Python is great for data science");
    storage.store("Rust provides memory safety without garbage collection");

    const results = storage.search("TypeScript JavaScript");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain("TypeScript");
  });

  it("filters by category", () => {
    storage.store("Prefer dark mode", "preference");
    storage.store("Dark themes reduce eye strain", "lesson");

    const results = storage.search("dark", { category: "preference" });
    expect(results.length).toBe(1);
    expect(results[0].category).toBe("preference");
  });

  it("filters by project", () => {
    storage.store("Rekindle uses SQLite", "context", 5, "rekindle");
    storage.store("Claw uses Express", "context", 5, "claw");

    const results = storage.search("uses", { project: "rekindle" });
    expect(results.length).toBe(1);
    expect(results[0].project).toBe("rekindle");
  });

  it("respects limit", () => {
    for (let i = 0; i < 20; i++) {
      storage.store(`Memory number ${i} about testing`);
    }
    const results = storage.search("testing", { limit: 5 });
    expect(results.length).toBe(5);
  });

  it("increments retrieval count on search", () => {
    const id = storage.store("Searchable content about databases");
    storage.search("databases");
    const mem = storage.get(id);
    expect(mem!.retrieval_count).toBe(1);
    expect(mem!.last_accessed).not.toBeNull();
  });

  it("boosts higher importance memories", () => {
    storage.store("Low importance memory about SQLite databases", "general", 1);
    storage.store("High importance memory about SQLite databases", "general", 10);

    const results = storage.search("SQLite databases");
    expect(results.length).toBe(2);
    expect(results[0].importance).toBe(10);
  });

  it("returns empty array for no matches", () => {
    storage.store("Something about cats");
    const results = storage.search("quantum_physics_xyz");
    expect(results).toEqual([]);
  });
});

describe("list", () => {
  it("lists all memories newest first", () => {
    storage.store("First");
    storage.store("Second");
    storage.store("Third");

    const all = storage.list();
    expect(all.length).toBe(3);
    expect(all[0].content).toBe("Third");
  });

  it("filters by category", () => {
    storage.store("A preference", "preference");
    storage.store("A lesson", "lesson");
    storage.store("Another preference", "preference");

    const prefs = storage.list({ category: "preference" });
    expect(prefs.length).toBe(2);
    expect(prefs.every((m) => m.category === "preference")).toBe(true);
  });

  it("filters by project", () => {
    storage.store("Rekindle note", "general", 5, "rekindle");
    storage.store("Other note", "general", 5, "other");

    const results = storage.list({ project: "rekindle" });
    expect(results.length).toBe(1);
  });

  it("respects limit", () => {
    for (let i = 0; i < 10; i++) {
      storage.store(`Memory ${i}`);
    }
    const results = storage.list({ limit: 3 });
    expect(results.length).toBe(3);
  });
});

describe("update", () => {
  it("updates content", () => {
    const id = storage.store("Original content");
    const ok = storage.update(id, { content: "Updated content" });
    expect(ok).toBe(true);
    expect(storage.get(id)!.content).toBe("Updated content");
  });

  it("updates category", () => {
    const id = storage.store("A memory", "general");
    storage.update(id, { category: "lesson" });
    expect(storage.get(id)!.category).toBe("lesson");
  });

  it("updates importance", () => {
    const id = storage.store("A memory");
    storage.update(id, { importance: 9 });
    expect(storage.get(id)!.importance).toBe(9);
  });

  it("returns false for nonexistent id", () => {
    expect(storage.update("nonexistent", { content: "nope" })).toBe(false);
  });

  it("updated content is searchable via FTS", () => {
    const id = storage.store("Original about cats");
    storage.update(id, { content: "Updated about quantum physics" });

    const catResults = storage.search("cats");
    expect(catResults.length).toBe(0);

    const physicsResults = storage.search("quantum physics");
    expect(physicsResults.length).toBe(1);
    expect(physicsResults[0].id).toBe(id);
  });
});

describe("delete", () => {
  it("deletes a memory", () => {
    const id = storage.store("To be deleted");
    expect(storage.delete(id)).toBe(true);
    expect(storage.get(id)).toBeNull();
  });

  it("returns false for nonexistent id", () => {
    expect(storage.delete("nonexistent")).toBe(false);
  });

  it("deleted content is not searchable", () => {
    const id = storage.store("Unique searchable content xyz123");
    storage.delete(id);
    const results = storage.search("xyz123");
    expect(results.length).toBe(0);
  });
});

describe("stats", () => {
  it("returns correct stats", () => {
    storage.store("Pref 1", "preference", 5, "rekindle");
    storage.store("Pref 2", "preference", 5, "rekindle");
    storage.store("Lesson 1", "lesson", 5, "claw");

    const stats = storage.stats();
    expect(stats.total).toBe(3);
    expect(stats.byCategory["preference"]).toBe(2);
    expect(stats.byCategory["lesson"]).toBe(1);
    expect(stats.byProject["rekindle"]).toBe(2);
    expect(stats.byProject["claw"]).toBe(1);
    expect(stats.recentCount).toBe(3);
  });

  it("returns zeros for empty database", () => {
    const stats = storage.stats();
    expect(stats.total).toBe(0);
    expect(stats.byCategory).toEqual({});
    expect(stats.byProject).toEqual({});
    expect(stats.recentCount).toBe(0);
  });
});

describe("getLatestCheckpoint", () => {
  it("returns the most recent context memory", () => {
    storage.store("Old checkpoint", "context", 7, "rekindle");
    storage.store("New checkpoint", "context", 7, "rekindle");

    const cp = storage.getLatestCheckpoint("rekindle");
    expect(cp).not.toBeNull();
    expect(cp!.content).toBe("New checkpoint");
  });

  it("returns null when no checkpoints exist", () => {
    storage.store("Not a checkpoint", "general");
    expect(storage.getLatestCheckpoint()).toBeNull();
  });

  it("filters by project", () => {
    storage.store("Rekindle checkpoint", "context", 7, "rekindle");
    storage.store("Claw checkpoint", "context", 7, "claw");

    const cp = storage.getLatestCheckpoint("claw");
    expect(cp!.content).toBe("Claw checkpoint");
  });
});

describe("performance", () => {
  it("handles 1000 memories with fast search", () => {
    for (let i = 0; i < 1000; i++) {
      storage.store(
        `Memory ${i}: This is test content about topic ${i % 50} with keywords batch${Math.floor(i / 100)}`,
        VALID_CATEGORIES[i % 5] as any,
        (i % 10) + 1,
        `project-${i % 5}`
      );
    }

    const start = performance.now();
    const results = storage.search("topic keywords batch", { limit: 10 });
    const elapsed = performance.now() - start;

    expect(results.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(100);
  });
});

const VALID_CATEGORIES = [
  "preference",
  "lesson",
  "context",
  "relationship",
  "general",
];
