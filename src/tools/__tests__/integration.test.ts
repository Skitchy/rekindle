import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RekindleStorage } from "../../storage/sqlite.js";
import { CaptureManager } from "../../captures/index.js";
import { createServer } from "../../server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
