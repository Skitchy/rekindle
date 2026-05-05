import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RekindleStorage } from "../storage/sqlite.js";

export function registerSearchMemory(
  server: McpServer,
  storage: RekindleStorage
): void {
  server.tool(
    "search_memory",
    "Search memories using full-text search. Returns ranked results with higher-importance memories boosted. Use at session start to load relevant context.",
    {
      query: z.string().describe("Search query (keywords or phrases)"),
      category: z
        .enum(["preference", "lesson", "context", "relationship", "general"])
        .optional()
        .describe("Filter by category"),
      project: z.string().optional().describe("Filter by project"),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(10)
        .describe("Maximum results to return"),
    },
    async ({ query, category, project, limit }) => {
      const results = storage.search(query, { category, project, limit });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              count: results.length,
              results: results.map((r) => ({
                id: r.id,
                content: r.content,
                category: r.category,
                importance: r.importance,
                project: r.project,
                created_at: r.created_at,
                retrieval_count: r.retrieval_count,
              })),
            }),
          },
        ],
      };
    }
  );
}
