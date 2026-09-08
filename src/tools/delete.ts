import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RekindleStorage } from "../storage/sqlite.js";
import { writeProvenanceSchema } from "./provenance.js";

export function registerDeleteMemory(
  server: McpServer,
  storage: RekindleStorage
): void {
  server.tool(
    "delete_memory",
    "Permanently delete a single memory from the local SQLite database by its ID. This action is irreversible — the row and its full-text search index entry are removed immediately. Use when a memory is outdated, incorrect, or no longer relevant. Returns {success: true} if the memory was found and deleted, or {success: false, message: 'Memory not found'} if the ID does not exist. Does not affect other memories or session records.",
    {
      id: z.string().describe("The UUID of the memory to delete. Obtain from store_memory, search_memory, or list_memories results."),
      provenance: writeProvenanceSchema.optional().describe("Write attribution. Required when REKINDLE_REQUIRE_WRITE_PROVENANCE=1; never proof of authorization."),
    },
    async ({ id, provenance }) => {
      const deleted = storage.delete(id, provenance);
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
