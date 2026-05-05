import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RekindleStorage } from "../storage/sqlite.js";

export function registerDeleteMemory(
  server: McpServer,
  storage: RekindleStorage
): void {
  server.tool(
    "delete_memory",
    "Delete a memory by ID. Use when a memory is outdated, incorrect, or no longer relevant.",
    {
      id: z.string().describe("The memory ID to delete"),
    },
    async ({ id }) => {
      const deleted = storage.delete(id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: deleted,
              message: deleted
                ? "Memory deleted"
                : "Memory not found",
            }),
          },
        ],
      };
    }
  );
}
