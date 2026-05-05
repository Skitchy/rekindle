import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RekindleStorage, type MemoryCategory } from "../storage/sqlite.js";

export function registerStoreMemory(
  server: McpServer,
  storage: RekindleStorage
): void {
  server.tool(
    "store_memory",
    "Store a memory. Use for preferences, lessons learned, project context, relationship notes, or general information worth remembering across sessions.",
    {
      content: z.string().describe("The memory content to store"),
      category: z
        .enum(["preference", "lesson", "context", "relationship", "general"])
        .default("general")
        .describe("Memory category"),
      importance: z
        .number()
        .min(1)
        .max(10)
        .default(5)
        .describe("Importance score 1-10 (higher = retrieved more often)"),
      project: z
        .string()
        .optional()
        .describe("Project scope for this memory"),
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
