import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function shippedTemplateLines(): Set<string> {
  for (const path of [
    join(__dirname, "..", "init", "templates", "identity.md"),
    join(__dirname, "..", "..", "src", "init", "templates", "identity.md"),
  ]) {
    if (existsSync(path)) {
      try {
        return new Set(readFileSync(path, "utf-8").split("\n").map((l) => l.trim()).filter(Boolean));
      } catch {
        // fall through to the next location
      }
    }
  }
  return new Set();
}

let templateLines: Set<string> | null = null;

/**
 * Whether an identity document says anything beyond the shipped template.
 * Headings, HTML comments, blank lines and lines copied verbatim from the
 * template don't count, so a fresh `rekindle init` file is "not filled in".
 */
export function identityHasContent(raw: string): boolean {
  templateLines ??= shippedTemplateLines();
  // An unclosed comment runs to the end of the file, as it would in HTML.
  const withoutComments = raw.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  return withoutComments
    .split("\n")
    .map((l) => l.trim())
    .some((l) => l.length > 0 && !l.startsWith("#") && !templateLines!.has(l));
}
