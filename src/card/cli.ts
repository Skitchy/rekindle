import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStorageRoot } from "../storage/root.js";
import { RekindleStorage } from "../storage/sqlite.js";
import { loadPolicy } from "../config/policy.js";
import { compileCard, CompileRefusal, PartialWriteError } from "./compile.js";
import { setCardPath } from "./path-config.js";
import { configuredCardPaths, normalizeCardPath, resolveUserCardPath } from "./user-card.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function templatePath(): string {
  const dist = join(__dirname, "..", "init", "templates", "user-card.md");
  if (existsSync(dist)) return dist;
  return join(__dirname, "..", "..", "src", "init", "templates", "user-card.md");
}

function valuesOf(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) out.push(args[++i]);
  }
  return out;
}

const USAGE = [
  "rekindle card: the user card, one Markdown file about you that any agent can read",
  "",
  "  rekindle card template <file>   Write a starter card to <file> (never overwrites)",
  "  rekindle card path <file>       Load <file> as the user card at startup (this store only)",
  "  rekindle card path --clear      Stop loading a card",
  "  rekindle card path              Show which card this store loads, if any",
  "  rekindle card compile --out <dir> [--include-project <name>]... [--from <file.md>]...",
  "                                  Draft a card from what this store already knows, for your review.",
  "                                  Writes card-draft.md and card-worksheet.md; never touches your card.",
].join("\n");

export function runCardCommand(args: string[], env: Record<string, string | undefined> = process.env): number {
  const sub = args[0];
  const root = resolveStorageRoot({ env });

  if (sub === "template") {
    const target = args[1];
    if (!target) {
      console.error("Usage: rekindle card template <file>");
      return 1;
    }
    const path = normalizeCardPath(target, process.cwd());
    if (existsSync(path)) {
      console.error(`${path} already exists; not overwriting it.`);
      return 1;
    }
    writeFileSync(path, readFileSync(templatePath(), "utf-8"), { mode: 0o600, flag: "wx" });
    console.log(`Wrote a starter card to ${path}. Fill it in, then run: rekindle card path ${path}`);
    return 0;
  }

  if (sub === "path") {
    if (args[1] === "--clear") {
      setCardPath(root.baseDir, null);
      console.log("This store no longer loads a user card.");
      return 0;
    }
    if (args[1]) {
      try {
        const stored = setCardPath(root.baseDir, args[1]);
        console.log(`This store now loads ${stored} as the user card at startup.`);
        console.log("Every agent that uses this store will receive it.");
        if (env.REKINDLE_USER_CARD && env.REKINDLE_USER_CARD.trim() !== "") {
          console.log("Note: REKINDLE_USER_CARD is set in this shell and takes precedence where it is set.");
        }
        return 0;
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        return 1;
      }
    }
    let policyPath: string | undefined;
    try {
      policyPath = loadPolicy(root.baseDir).policy.user_card_path;
    } catch (err) {
      console.error(`policy.json is invalid: ${err instanceof Error ? err.message : String(err)}`);
    }
    const resolved = resolveUserCardPath(env, policyPath, root.baseDir);
    console.log(resolved.path ? `${resolved.path} (from ${resolved.source})` : "No user card configured.");
    return 0;
  }

  if (sub === "compile") {
    const out = valuesOf(args, "--out")[0];
    if (!out) {
      console.error("Usage: rekindle card compile --out <dir> [--include-project <name>]... [--from <file.md>]...");
      return 1;
    }
    const outDir = resolve(process.cwd(), out);
    if (!existsSync(outDir)) {
      console.error(`Output directory ${outDir} does not exist.`);
      return 1;
    }
    // Fail closed: an unreadable or invalid policy is not "no card configured".
    // If compile cannot tell where the card is, it cannot promise not to overwrite it.
    let policyPath: string | undefined;
    try {
      policyPath = loadPolicy(root.baseDir).policy.user_card_path;
    } catch (err) {
      console.error(
        `Not compiling: policy.json could not be read (${err instanceof Error ? err.message : String(err)}). ` +
          "Fix it first, so compile knows which file is your card."
      );
      return 1;
    }
    // Protect every configured card, the one the env var shadows included.
    const cards = configuredCardPaths(env, policyPath, root.baseDir);
    const storage = new RekindleStorage(root.dbPath);
    try {
      const result = compileCard({
        storage,
        protectedPaths: [...cards, root.dbPath, `${root.dbPath}-wal`, `${root.dbPath}-shm`],
        identityPath: join(root.baseDir, ".rekindle", "identity.md"),
        includeProjects: valuesOf(args, "--include-project"),
        fromFiles: valuesOf(args, "--from").map((f) => resolve(process.cwd(), f)),
        outDir,
      });
      console.log(`Draft:     ${result.draftPath}`);
      console.log(`Worksheet: ${result.worksheetPath}`);
      console.log(`${result.entries} candidate entries. Review the worksheet; nothing was written to your card.`);
      for (const m of result.missing) console.log(`Not included: ${m}`);
      return 0;
    } catch (err) {
      if (err instanceof CompileRefusal) {
        console.error(err.message);
        return 1;
      }
      if (err instanceof PartialWriteError) {
        console.error(`Partial write: ${err.message}`);
        return 1;
      }
      throw err;
    } finally {
      storage.close();
    }
  }

  console.log(USAGE);
  return sub === undefined || sub === "help" || sub === "--help" ? 0 : 1;
}
