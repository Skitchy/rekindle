import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { RekindleStorage } from "../storage/sqlite.js";
import { setupHooks } from "./setup-hooks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getTemplatePath(name: string): string {
  // In dist, templates are at dist/init/templates/
  // We need to find them relative to the compiled JS
  const distPath = join(__dirname, "templates", name);
  if (existsSync(distPath)) return distPath;

  // Fallback: source path (for development)
  const srcPath = join(__dirname, "..", "..", "src", "init", "templates", name);
  if (existsSync(srcPath)) return srcPath;

  throw new Error(`Template not found: ${name}`);
}

export function scaffold(targetDir: string): void {
  const rekindleDir = join(targetDir, ".rekindle");
  const dbDir = join(rekindleDir, "db");
  const transcriptDir = join(rekindleDir, "transcripts");

  if (existsSync(rekindleDir)) {
    console.log(".rekindle/ already exists. Skipping scaffold.");
    return;
  }

  // Create directories
  mkdirSync(dbDir, { recursive: true });
  mkdirSync(transcriptDir, { recursive: true });

  // Initialize database
  const dbPath = join(dbDir, "memories.db");
  const storage = new RekindleStorage(dbPath);
  storage.close();
  console.log("Created database: .rekindle/db/memories.db");

  // Copy identity template
  const identityTemplate = readFileSync(getTemplatePath("identity.md"), "utf-8");
  writeFileSync(join(rekindleDir, "identity.md"), identityTemplate);
  console.log("Created identity template: .rekindle/identity.md");

  // Add .rekindle/ to .gitignore
  const gitignorePath = join(targetDir, ".gitignore");
  if (existsSync(gitignorePath)) {
    const existing = readFileSync(gitignorePath, "utf-8");
    if (!existing.includes(".rekindle/")) {
      appendFileSync(gitignorePath, "\n# Rekindle (local AI memory)\n.rekindle/\n");
      console.log("Added .rekindle/ to .gitignore");
    }
  } else {
    writeFileSync(gitignorePath, "# Rekindle (local AI memory)\n.rekindle/\n");
    console.log("Created .gitignore with .rekindle/");
  }

  // Print boot instructions
  const bootInstructions = readFileSync(getTemplatePath("boot.md"), "utf-8");
  console.log("\n" + "=".repeat(60));
  console.log("Add the following to your CLAUDE.md (or system prompt):");
  console.log("=".repeat(60) + "\n");
  console.log(bootInstructions);

  const isNpmInstall = __dirname.split(sep).includes("node_modules");

  const mcpConfig = isNpmInstall
    ? {
        mcpServers: {
          rekindle: {
            command: "npx",
            args: ["-y", "rekindle"],
            env: { REKINDLE_DB_PATH: dbPath },
          },
        },
      }
    : {
        mcpServers: {
          rekindle: {
            command: "node",
            args: [join(__dirname, "..", "index.js")],
            env: { REKINDLE_DB_PATH: dbPath },
          },
        },
      };

  console.log("=".repeat(60));
  console.log("Add to your Claude Code MCP config (~/.claude.json):");
  console.log("=".repeat(60) + "\n");
  console.log(JSON.stringify(mcpConfig, null, 2));

  // Set up PreCompact hook
  mkdirSync(join(rekindleDir, "captures"), { recursive: true });
  setupHooks(targetDir);

  console.log("\n" + "=".repeat(60));
  console.log("Done! Fill in .rekindle/identity.md, then start a new session.");
  console.log("Session 1 stores. Session 2 remembers.");
  console.log("=".repeat(60));
}
