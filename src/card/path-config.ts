import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY, validatePolicy } from "../config/policy.js";
import { normalizeCardPath } from "./user-card.js";
import { writeViaTemp } from "./compile.js";

/**
 * Point this store at a card file, or clear it, by editing only the
 * user_card_path field of .rekindle/policy.json. Every other field is kept as
 * the file has it. Works on an existing store, unlike init, which skips when
 * .rekindle/ already exists.
 *
 * A path typed at the terminal resolves against the terminal's cwd (what the
 * user means), then is stored absolute so the hook and the server agree.
 *
 * The new policy is written to a private temp file in the same directory and
 * renamed over the old one, so a failed write leaves the old policy intact.
 */
export function setCardPath(baseDir: string, file: string | null, cwd: string = process.cwd()): string | null {
  const rekindleDir = join(baseDir, ".rekindle");
  const policyPath = join(rekindleDir, "policy.json");

  let stored: string | null = null;
  if (file !== null) {
    if (file.trim() === "") throw new Error("No card file given.");
    const absolute = normalizeCardPath(file, cwd);
    if (!existsSync(absolute)) {
      throw new Error(`No file at ${absolute}. Create the card first, then point Rekindle at it.`);
    }
    if (!statSync(absolute).isFile()) {
      throw new Error(`${absolute} is not a regular file. The card must be a plain Markdown file.`);
    }
    stored = realpathSync(absolute);
  }

  const current: Record<string, unknown> = existsSync(policyPath)
    ? (JSON.parse(readFileSync(policyPath, "utf-8")) as Record<string, unknown>)
    : { ...DEFAULT_POLICY };
  if (stored === null) delete current.user_card_path;
  else current.user_card_path = stored;

  // Validate before writing, so a bad result never replaces a working policy.
  validatePolicy(current);
  mkdirSync(rekindleDir, { recursive: true });
  const mode = existsSync(policyPath) ? statSync(policyPath).mode & 0o777 : 0o644;
  writeViaTemp(policyPath, JSON.stringify(current, null, 2) + "\n", mode);
  return stored;
}
