import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RekindleStorage } from "./storage/sqlite.js";
import { registerStoreMemory } from "./tools/store.js";
import { registerSearchMemory } from "./tools/search.js";
import { registerListMemories } from "./tools/list.js";
import { registerDeleteMemory } from "./tools/delete.js";
import { registerUpdateMemory } from "./tools/update.js";
import { registerBootReport } from "./tools/boot-report.js";
import { registerEndSession } from "./tools/end-session.js";

export function createServer(storage: RekindleStorage): McpServer {
  const server = new McpServer({
    name: "rekindle",
    version: "0.2.0",
  });

  registerStoreMemory(server, storage);
  registerSearchMemory(server, storage);
  registerListMemories(server, storage);
  registerDeleteMemory(server, storage);
  registerUpdateMemory(server, storage);
  registerBootReport(server, storage);
  registerEndSession(server, storage);

  return server;
}

export async function startServer(storage: RekindleStorage): Promise<void> {
  const server = createServer(storage);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
