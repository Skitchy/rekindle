import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RekindleStorage } from "./storage/sqlite.js";
import { CaptureManager } from "./captures/index.js";
import { registerStoreMemory } from "./tools/store.js";
import { registerSearchMemory } from "./tools/search.js";
import { registerListMemories } from "./tools/list.js";
import { registerDeleteMemory } from "./tools/delete.js";
import { registerUpdateMemory } from "./tools/update.js";
import { registerBootReport } from "./tools/boot-report.js";
import { registerEndSession } from "./tools/end-session.js";
import { registerListCaptures } from "./tools/list-captures.js";
import { registerReadCapture } from "./tools/read-capture.js";
import { registerCaptureNow } from "./tools/capture-now.js";

export function createServer(storage: RekindleStorage, captureManager: CaptureManager): McpServer {
  const server = new McpServer(
    {
      name: "rekindle",
      version: "0.3.0",
    },
    {
      instructions:
        "Rekindle is a local continuity server. At session start, call boot_report before substantive work to inspect identity, project-scoped memory state, the latest checkpoint, open loops, and available PreCompact captures. If captures are listed, use list_captures and read_capture to recover context before relying on the checkpoint. At session end, call end_session with the checkpoint, unresolved open loops, constraints, warnings, and next-session focus. Orientation scores are structural checks, not guarantees that every relevant context item was loaded.",
    }
  );

  registerStoreMemory(server, storage);
  registerSearchMemory(server, storage);
  registerListMemories(server, storage);
  registerDeleteMemory(server, storage);
  registerUpdateMemory(server, storage);
  registerBootReport(server, storage, captureManager);
  registerEndSession(server, storage, captureManager);
  registerListCaptures(server, captureManager);
  registerReadCapture(server, captureManager);
  registerCaptureNow(server, captureManager);

  return server;
}

export async function startServer(storage: RekindleStorage, captureManager: CaptureManager): Promise<void> {
  const server = createServer(storage, captureManager);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
