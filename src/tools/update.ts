import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RekindleStorage, type MemoryCategory } from "../storage/sqlite.js";

export function registerUpdateMemory(
  server: McpServer,
  storage: RekindleStorage
): void {
  server.tool(
    "update_memory",
    "Update an existing memory in the local SQLite database. Modifies only the fields you provide — omitted fields are left unchanged. The updated_at timestamp is set automatically. If content is changed, the full-text search index is rebuilt for this memory. Returns the full updated memory object on success, or {success: false, message: 'Memory not found'} if the ID does not exist. Use to correct inaccurate memories, adjust importance, or reclassify a memory's category without deleting and re-creating it.",
    {
      id: z.string().describe("The UUID of the memory to update. Obtain from store_memory, search_memory, or list_memories results."),
      content: z.string().optional().describe("Replacement content for the memory. Omit to keep the existing content unchanged."),
      category: z
        .enum(["preference", "lesson", "context", "relationship", "general"])
        .optional()
        .describe("New category for the memory. Omit to keep the existing category unchanged."),
      importance: z
        .number()
        .min(1)
        .max(10)
        .optional()
        .describe("New importance score from 1 (low) to 10 (critical). Omit to keep the existing score unchanged."),
    },
    async ({ id, content, category, importance }) => {
      const updated = storage.update(id, {
        content,
        category: category as MemoryCategory | undefined,
        importance,
      });

      if (!updated) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                message: "Memory not found",
              }),
            },
          ],
        };
      }

      const memory = storage.get(id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: true, memory }),
          },
        ],
      };
    }
  );
}
