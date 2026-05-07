import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RekindleStorage } from "../storage/sqlite.js";

export function registerSearchMemory(
  server: McpServer,
  storage: RekindleStorage
): void {
  server.tool(
    "search_memory",
    "Search stored memories using SQLite full-text search (FTS5). Returns results ranked by relevance with higher-importance memories boosted. Each search increments the retrieval_count on matched memories, tracking which memories are accessed most. Use at session start to load relevant context, or mid-session to recall specific information. Returns an array of matching memories with id, content, category, importance, project, created_at, and retrieval_count. Returns an empty array if no matches are found.",
    {
      query: z.string().describe("Full-text search query. Supports keywords, phrases, and SQLite FTS5 syntax (e.g., 'database AND migration', '\"exact phrase\"'). Broader queries return more results."),
      category: z
        .enum(["preference", "lesson", "context", "relationship", "general"])
        .optional()
        .describe("Filter results to a single category. Omit to search across all categories."),
      project: z.string().optional().describe("Filter results to a specific project. Omit to search across all projects."),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(10)
        .describe("Maximum number of results to return. Default 10. Results are ranked by relevance and importance before truncation."),
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
