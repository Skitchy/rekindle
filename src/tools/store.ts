import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RekindleStorage, type MemoryCategory } from "../storage/sqlite.js";

export function registerStoreMemory(
  server: McpServer,
  storage: RekindleStorage
): void {
  server.tool(
    "store_memory",
    "Store a new memory in the local SQLite database. Creates a persistent row with an auto-generated UUID, timestamp, and the provided content. Use for preferences, lessons learned, project context, relationship notes, or general information worth remembering across sessions. Memories persist across sessions and are surfaced by boot_report, search_memory, and list_memories. Returns the generated ID on success. Does not deduplicate — calling twice with the same content creates two separate memories.",
    {
      content: z.string().describe("The memory content to store. Plain text, no length limit. Should be self-contained — future retrieval may return this memory without surrounding context."),
      category: z
        .enum(["preference", "lesson", "context", "relationship", "general"])
        .default("general")
        .describe("Memory category. Determines how the memory is weighted during orientation: 'preference' and 'relationship' contribute to the orientation score. 'context' is used for checkpoints and session handoffs. 'lesson' is used for constraints and warnings. 'general' is the default catch-all."),
      importance: z
        .number()
        .min(1)
        .max(10)
        .default(5)
        .describe("Importance score from 1 (low) to 10 (critical). Higher-importance memories are ranked first in search results. Constraints default to 9, checkpoints to 8, general notes to 5."),
      project: z
        .string()
        .optional()
        .describe("Project name to scope this memory to. When set, boot_report can filter orientation to this project. Omit for cross-project memories."),
    },
    async ({ content, category, importance, project }) => {
      const id = storage.store(
        content,
        category as MemoryCategory,
        importance,
        project
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ id, message: "Memory stored" }),
          },
        ],
      };
    }
  );
}
