import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function shippedTemplateLines(name: string): Set<string> {
  for (const path of [
    join(__dirname, "..", "init", "templates", name),
    join(__dirname, "..", "..", "src", "init", "templates", name),
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

const templateCache = new Map<string, Set<string>>();

/** One entry per template, so one detector can never answer from the other's lines. */
function templateLines(name: string): Set<string> {
  let lines = templateCache.get(name);
  if (!lines) {
    lines = shippedTemplateLines(name);
    templateCache.set(name, lines);
  }
  return lines;
}

/**
 * Whether an identity document says anything beyond the shipped template.
 * Headings, HTML comments, blank lines and lines copied verbatim from the
 * template don't count, so a fresh `rekindle init` file is "not filled in".
 */
export function identityHasContent(raw: string): boolean {
  const shipped = templateLines("identity.md");
  // An unclosed comment runs to the end of the file, as it would in HTML.
  const withoutComments = raw.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  return withoutComments
    .split("\n")
    .map((l) => l.trim())
    .some((l) => l.length > 0 && !l.startsWith("#") && !shipped.has(l));
}

/**
 * A whole line that is one plain comment. Anything ambiguous or malformed, such
 * as an early close (`<!-->`, `<!--->`, `--!>`) or a nested opener, can hide
 * text after it, so it is treated as text the user wrote.
 */
function isSingleLineComment(line: string): boolean {
  if (line.length < 7 || !line.startsWith("<!--") || !line.endsWith("-->")) return false;
  const body = line.slice(4, -3);
  return !body.startsWith(">") && !body.startsWith("->") && !["-->", "--!>", "<!--"].some((mark) => body.includes(mark));
}

/**
 * Whether a user card says anything beyond the shipped template (#38).
 * Stricter than the identity check, and read one line at a time: a line counts
 * unless it is a line of the template or a single-line comment. So an authored
 * heading counts, and so does anything in a multi-line or unclosed comment,
 * because one authored line must load the whole card. If the template cannot be
 * read, only single-line comments and blank lines are ignored.
 */
export function userCardHasContent(raw: string): boolean {
  const shipped = templateLines("user-card.md");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .some((l) => l.length > 0 && !shipped.has(l) && !isSingleLineComment(l));
}
