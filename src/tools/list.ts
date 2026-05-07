import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RekindleStorage } from "../storage/sqlite.js";

export function registerListMemories(
  server: McpServer,
  storage: RekindleStorage
): void {
  server.tool(
    "list_memories",
    "List stored memories from the local SQLite database, ordered newest first. Unlike search_memory, this does not require a query — it returns all memories matching the optional filters. Read-only; does not modify any data. Use to browse what has been stored, audit memory contents, or check memory counts per category or project. Returns an array of memories with id, content, category, importance, project, and created_at.",
    {
      category: z
        .enum(["preference", "lesson", "context", "relationship", "general"])
        .optional()
        .describe("Filter to a single category. Omit to list memories across all categories."),
      project: z.string().optional().describe("Filter to a specific project. Omit to list memories across all projects."),
      limit: z
        .number()
        .min(1)
        .max(200)
        .default(50)
        .describe("Maximum number of memories to return. Default 50. Newest memories are returned first regardless of limit."),
    },
    async ({ category, project, limit }) => {
      const memories = storage.list({ category, project, limit });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              count: memories.length,
              memories: memories.map((m) => ({
                id: m.id,
                content: m.content,
                category: m.category,
                importance: m.importance,
                project: m.project,
                created_at: m.created_at,
              })),
            }),
          },
        ],
      };
    }
  );
}
