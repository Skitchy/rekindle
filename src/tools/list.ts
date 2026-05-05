import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RekindleStorage } from "../storage/sqlite.js";

export function registerListMemories(
  server: McpServer,
  storage: RekindleStorage
): void {
  server.tool(
    "list_memories",
    "List stored memories, optionally filtered by category or project. Returns newest first.",
    {
      category: z
        .enum(["preference", "lesson", "context", "relationship", "general"])
        .optional()
        .describe("Filter by category"),
      project: z.string().optional().describe("Filter by project"),
      limit: z
        .number()
        .min(1)
        .max(200)
        .default(50)
        .describe("Maximum results to return"),
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
