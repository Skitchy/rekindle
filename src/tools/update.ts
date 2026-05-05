import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RekindleStorage, type MemoryCategory } from "../storage/sqlite.js";

export function registerUpdateMemory(
  server: McpServer,
  storage: RekindleStorage
): void {
  server.tool(
    "update_memory",
    "Update an existing memory. Provide the ID and any fields to change.",
    {
      id: z.string().describe("The memory ID to update"),
      content: z.string().optional().describe("New content"),
      category: z
        .enum(["preference", "lesson", "context", "relationship", "general"])
        .optional()
        .describe("New category"),
      importance: z
        .number()
        .min(1)
        .max(10)
        .optional()
        .describe("New importance score"),
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
