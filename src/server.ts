import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { composeInstructions } from "./delivery/guidance.js";
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
import { REKINDLE_VERSION } from "./version.js";

export function createServer(storage: RekindleStorage, captureManager: CaptureManager): McpServer {
  const server = new McpServer(
    {
      name: "rekindle",
      version: REKINDLE_VERSION,
    },
    {
      // Composed from the same fragments that ride the tool descriptions —
      // Desktop never shows the model this field (CD-M-01), so it must never
      // carry guidance the descriptions do not.
      instructions: composeInstructions(),
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
