import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { RekindleStorage } from "../storage/sqlite.js";
import type { HookScope } from "./settings-target.js";

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

/**
 * MCP registration lines printed by `init`, matching the README's Claude Code section.
 * `claude mcp add` defaults to local scope (this project only), so a `--global`
 * init, whose hooks run in every project, must register the server at user scope
 * or the hooks would fire where the server is not registered.
 */
export function mcpInstructions(scope: HookScope, isNpmInstall: boolean, mcpConfig: unknown): string[] {
  const lines: string[] = [];
  if (isNpmInstall) {
    const scopeFlag = scope === "user" ? "--scope user " : "";
    lines.push(`  claude mcp add ${scopeFlag}rekindle -- npx -y rekindle\n`);
    lines.push(
      scope === "user"
        ? "Or add it to the top-level mcpServers of ~/.claude.json by hand (user scope, every project):\n"
        : "Or add it to ~/.claude.json by hand:\n"
    );
  } else {
    lines.push("Add to ~/.claude.json (source install, points at this build):\n");
  }
  lines.push(JSON.stringify(mcpConfig, null, 2));
  return lines;
}

export function scaffold(targetDir: string, scope: HookScope = "project"): void {
  const rekindleDir = join(targetDir, ".rekindle");
  const dbDir = join(rekindleDir, "db");
  const transcriptDir = join(rekindleDir, "transcripts");
  // Paths as the user will see them: ~/.rekindle under --global, ./.rekindle otherwise.
  const shown = scope === "user" ? "~/.rekindle" : ".rekindle";
  const globalFlag = scope === "user" ? " --global" : "";

  if (existsSync(rekindleDir)) {
    console.log(`${shown}/ already exists. Skipping scaffold.`);
    return;
  }

  // Create directories
  mkdirSync(dbDir, { recursive: true });
  mkdirSync(transcriptDir, { recursive: true });

  // Initialize database
  const dbPath = join(dbDir, "memories.db");
  const storage = new RekindleStorage(dbPath);
  storage.close();
  console.log(`Created database: ${shown}/db/memories.db`);

  // Copy identity template
  const identityTemplate = readFileSync(getTemplatePath("identity.md"), "utf-8");
  writeFileSync(join(rekindleDir, "identity.md"), identityTemplate);
  console.log(`Created identity template: ${shown}/identity.md`);

  for (const name of ["policy.json", "projects.json"]) {
    writeFileSync(join(rekindleDir, name), readFileSync(getTemplatePath(name), "utf-8"));
    console.log(`Created continuity configuration: ${shown}/${name}`);
  }

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

  // Same instructions as the README's Claude Code section: one command first,
  // the hand-edit JSON as the fallback. A source checkout cannot use `npx -y
  // rekindle`, so it gets the node command pointing at this build instead.
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
  console.log("Register the MCP server with Claude Code:");
  console.log("=".repeat(60) + "\n");
  for (const line of mcpInstructions(scope, isNpmInstall, mcpConfig)) console.log(line);

  mkdirSync(join(rekindleDir, "captures"), { recursive: true });

  console.log("\n" + "=".repeat(60));
  console.log("Optional hooks (both opt-in; plain init installs neither):");
  console.log("=".repeat(60));
  console.log("Session-start orientation, delivered automatically at startup/resume/clear/compact:");
  console.log(`  npx rekindle setup-delivery${globalFlag}`);
  console.log("PreCompact protection (captures context before mid-session compaction):");
  console.log(`  npx rekindle setup-hooks${globalFlag}`);
  console.log("=".repeat(60));

  console.log("\n" + "=".repeat(60));
  console.log(`Done! Fill in ${shown}/identity.md, then start a new session.`);
  console.log("Session 1 stores. Session 2 remembers.");
  console.log("=".repeat(60));
}
