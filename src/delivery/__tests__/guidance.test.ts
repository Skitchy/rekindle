import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RekindleStorage } from "../../storage/sqlite.js";
import { CaptureManager } from "../../captures/index.js";
import { createServer } from "../../server.js";
import {
  WORKFLOW_GUIDANCE,
  composeInstructions,
  withGuidance,
} from "../guidance.js";

describe("guidance composition (unit)", () => {
  it("withGuidance appends the fragment for tools that have one", () => {
    expect(withGuidance("boot_report", "Base.")).toBe(
      `Base. ${WORKFLOW_GUIDANCE.boot_report}`
    );
  });

  it("withGuidance leaves tools without a fragment untouched", () => {
    expect(withGuidance("store_memory", "Base.")).toBe("Base.");
  });

  it("composeInstructions contains every fragment verbatim (channels cannot drift)", () => {
    const instructions = composeInstructions();
    for (const fragment of Object.values(WORKFLOW_GUIDANCE)) {
      expect(instructions).toContain(fragment);
    }
  });

  it("fragments carry the load-bearing workflow sentinels", () => {
    // These exact phrases are the gate-2 measurement sentinels. A failure
    // here means the Desktop probe's grep targets changed — rewording is a
    // measurement-invalidating change and must be deliberate.
    expect(WORKFLOW_GUIDANCE.boot_report).toContain(
      "call boot_report first thing every session"
    );
    expect(WORKFLOW_GUIDANCE.boot_report).toContain(
      "structural checks, not guarantees"
    );
    expect(WORKFLOW_GUIDANCE.end_session).toContain(
      "call end_session at the end of every substantive session"
    );
    expect(WORKFLOW_GUIDANCE.list_captures).toContain(
      "call list_captures then read_capture"
    );
  });
});

describe("guidance delivery (protocol surface)", () => {
  // Desktop shows the model ONLY the tool listing (CD-M-01). These tests
  // assert the workflow guidance through that exact surface: the real MCP
  // protocol's tools/list response, not the source strings.
  let storage: RekindleStorage;
  let client: Client;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "rekindle-guidance-"));
    storage = new RekindleStorage(join(tmpDir, "db", "memories.db"));
    const captureManager = new CaptureManager(tmpDir);
    const server = createServer(storage, captureManager);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "guidance-test-client", version: "1.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  afterEach(() => {
    storage.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("every workflow fragment is visible in its tool's listed description", async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t.description ?? ""]));
    for (const [toolName, fragment] of Object.entries(WORKFLOW_GUIDANCE)) {
      const description = byName.get(toolName);
      expect(description, `tool ${toolName} must be registered`).toBeDefined();
      expect(
        description,
        `workflow fragment for ${toolName} must ride its description`
      ).toContain(fragment);
    }
  });

  it("the complete session workflow is reconstructible from descriptions alone", async () => {
    // The Desktop invariant: a model that sees nothing but the tool listing
    // must still learn boot-first, recover-captures, end-session-last.
    const { tools } = await client.listTools();
    const allDescriptions = tools.map((t) => t.description ?? "").join("\n");
    expect(allDescriptions).toContain("call boot_report first thing every session");
    expect(allDescriptions).toContain("call list_captures then read_capture");
    expect(allDescriptions).toContain(
      "call end_session at the end of every substantive session"
    );
  });

  it("instructions field carries no guidance the descriptions lack", async () => {
    // The inverse drift check: since Desktop never shows `instructions`,
    // every workflow sentence in it must also travel on a description.
    const { tools } = await client.listTools();
    const allDescriptions = tools.map((t) => t.description ?? "").join("\n");
    for (const fragment of Object.values(WORKFLOW_GUIDANCE)) {
      expect(allDescriptions).toContain(fragment);
    }
    // And composeInstructions is exactly preamble + those fragments — no
    // free-floating guidance can be added without a fragment.
    const fragmentsJoined = Object.values(WORKFLOW_GUIDANCE).join(" ");
    expect(composeInstructions().endsWith(fragmentsJoined)).toBe(true);
  });
});
