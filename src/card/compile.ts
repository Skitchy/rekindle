import { closeSync, existsSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { RekindleStorage } from "../storage/sqlite.js";

export const DRAFT_NAME = "card-draft.md";
export const WORKSHEET_NAME = "card-worksheet.md";
export const DEFAULT_SOURCE_CAP = 2000;
export const STALE_DAYS = 180;

export const WORKSHEET_WARNING =
  "Review required. Conflict, secret and staleness detection is incomplete; this is a candidate list, not a sanitized card.";

export interface CompileOptions {
  storage: RekindleStorage;
  /** Files compile must never write over: the configured card, identity.md, the db. */
  protectedPaths: string[];
  identityPath: string;
  includeProjects: string[];
  fromFiles: string[];
  outDir: string;
  now?: Date;
  cap?: number;
}

type EntryKind = "preference" | "boundary" | "about" | "project" | "imported";

interface Entry {
  kind: EntryKind;
  text: string;
  /** Record id or file name. Worksheet only; never written into the draft. */
  ref: string;
  project: string | null;
  date: string | null;
  flags: string[];
}

export interface CompileResult {
  draftPath: string;
  worksheetPath: string;
  entries: number;
  capped: boolean;
  missing: string[];
}

export class CompileRefusal extends Error {}

export class PartialWriteError extends Error {
  constructor(message: string, readonly completed: string[], readonly failed: string) {
    super(message);
  }
}

/** The "What I Know About My Person" section of identity.md, minus template comments. */
export function identityAboutSection(identity: string): string[] {
  const lines = identity.split("\n");
  const start = lines.findIndex((l) => /^##\s+What I Know About My Person\s*$/.test(l.trim()));
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    out.push(line);
  }
  return out
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isStale(date: string | null, now: Date): boolean {
  if (!date) return false;
  const t = Date.parse(date.includes("T") ? date : date.replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return false;
  return now.getTime() - t > STALE_DAYS * 24 * 60 * 60 * 1000;
}

function cell(text: string): string {
  return normalize(text).replace(/\|/g, "\\|");
}

/** Identity of a path on disk, or null when it does not exist. */
function fileId(path: string): { real: string; dev: number; ino: number } | null {
  try {
    const st = statSync(path);
    return { real: realpathSync(path), dev: st.dev, ino: st.ino };
  } catch {
    return null;
  }
}

/** The canonical location an output would occupy, resolving its directory. */
function outputLocation(path: string): string {
  const dir = dirname(path);
  const realDir = existsSync(dir) ? realpathSync(dir) : resolve(dir);
  return join(realDir, basename(path));
}

/**
 * Refuse any output that is, or could write through to, a protected file or the
 * other output: a symlink at the output path, a hardlink (same device and inode),
 * or the same canonical path.
 */
export function assertNoAliases(outputs: string[], protectedPaths: string[]): void {
  const protectedIds = protectedPaths.map((p) => ({ path: p, id: fileId(p), loc: outputLocation(p) }));
  const seen: Array<{ path: string; loc: string; id: ReturnType<typeof fileId> }> = [];
  for (const out of outputs) {
    let link = false;
    try {
      link = lstatSync(out).isSymbolicLink();
    } catch {
      link = false;
    }
    if (link) throw new CompileRefusal(`Refusing to write ${basename(out)}: it is a symbolic link.`);
    const loc = outputLocation(out);
    const id = fileId(out);
    for (const p of protectedIds) {
      const sameInode = id && p.id && id.dev === p.id.dev && id.ino === p.id.ino;
      if (loc === p.loc || (p.id && loc === p.id.real) || sameInode) {
        throw new CompileRefusal(`Refusing to write ${basename(out)}: it is the same file as a compile input or your card.`);
      }
    }
    for (const other of seen) {
      const sameInode = id && other.id && id.dev === other.id.dev && id.ino === other.id.ino;
      if (loc === other.loc || sameInode) {
        throw new CompileRefusal(`Refusing to write ${basename(out)}: it is the same file as ${basename(other.path)}.`);
      }
    }
    seen.push({ path: out, loc, id });
  }
}

/**
 * Write text to path through a private temp file in the same directory, then
 * rename. The temp is opened exclusively, and only a temp this call actually
 * created is ever removed, so a pre-existing file at the temp name survives.
 */
export type WriteFn = (fd: number, buffer: Buffer, offset: number, length: number) => number;

export function writeViaTemp(
  path: string,
  text: string,
  mode: number,
  suffix: () => string = () => randomBytes(6).toString("hex"),
  write: WriteFn = (fd, buffer, offset, length) => writeSync(fd, buffer, offset, length)
): void {
  const tmp = join(dirname(path), `.${basename(path)}.${suffix()}.tmp`);
  let fd: number | null = null;
  let owned = false;
  try {
    fd = openSync(tmp, "wx", mode);
    owned = true;
    // Write every byte. A write may be short (a file-size limit, a full disk);
    // keep going from where it stopped, and treat a zero-byte write as failure,
    // so an incomplete temp is never renamed into place.
    const bytes = Buffer.from(text, "utf-8");
    let offset = 0;
    while (offset < bytes.length) {
      const n = write(fd, bytes, offset, bytes.length - offset);
      if (!(n > 0)) throw new Error(`write stalled after ${offset} of ${bytes.length} bytes`);
      offset += n;
    }
    closeSync(fd);
    fd = null;
    renameSync(tmp, path);
    owned = false;
  } catch (err) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // already closed
      }
    }
    if (owned) {
      try {
        unlinkSync(tmp);
      } catch {
        // nothing left to clean up
      }
    }
    throw err;
  }
}

export function compileCard(opts: CompileOptions): CompileResult {
  const now = opts.now ?? new Date();
  const cap = opts.cap ?? DEFAULT_SOURCE_CAP;
  const draftPath = join(opts.outDir, DRAFT_NAME);
  const worksheetPath = join(opts.outDir, WORKSHEET_NAME);

  assertNoAliases([draftPath, worksheetPath], [...opts.protectedPaths, opts.identityPath, ...opts.fromFiles]);

  const entries: Entry[] = [];
  const missing: string[] = [];

  const { rows, capped } = opts.storage.listCardSources({
    includeProjectless: true,
    projects: opts.includeProjects,
    cap,
  });
  for (const row of rows) {
    const kind: EntryKind = row.project !== null ? "project" : row.type === "constraint" ? "boundary" : "preference";
    entries.push({ kind, text: row.content, ref: row.id, project: row.project, date: row.created_at, flags: [] });
  }
  if (capped) missing.push(`Records beyond the ${cap}-record cap were not read.`);

  if (existsSync(opts.identityPath)) {
    try {
      for (const line of identityAboutSection(readFileSync(opts.identityPath, "utf-8"))) {
        entries.push({ kind: "about", text: line, ref: "identity.md", project: null, date: null, flags: [] });
      }
    } catch {
      missing.push("identity.md could not be read.");
    }
  } else {
    missing.push("identity.md was not found.");
  }

  const imported: Array<{ name: string; text: string }> = [];
  for (const file of opts.fromFiles) {
    try {
      imported.push({ name: basename(file), text: readFileSync(file, "utf-8").trimEnd() });
      entries.push({ kind: "imported", text: `(imported file, ${basename(file)})`, ref: basename(file), project: null, date: null, flags: [] });
    } catch {
      missing.push(`--from ${basename(file)} could not be read.`);
    }
  }

  const included = new Set(opts.includeProjects);
  const notIncluded = opts.storage.cardSourceProjects().filter((p) => !included.has(p));
  if (notIncluded.length > 0) {
    missing.push(`Project records not included (add --include-project <name>): ${notIncluded.join(", ")}.`);
  }

  // Deterministic rules only: newest first (storage order), collapse exact
  // duplicates after whitespace normalization, mark old entries. Nothing here
  // judges contradictions, secrets or whether a project is still current.
  const firstByText = new Map<string, Entry>();
  for (const e of entries) {
    if (e.kind === "imported") continue;
    const key = normalize(e.text);
    const first = firstByText.get(key);
    if (first) {
      e.flags.push(`duplicate of ${first.ref}; left out of the draft`);
    } else {
      firstByText.set(key, e);
    }
    if (isStale(e.date, now)) e.flags.push(`check: may be stale (over ${STALE_DAYS} days old)`);
  }
  const kept = entries.filter((e) => !e.flags.some((f) => f.startsWith("duplicate of")));

  const draft: string[] = [
    "# User card (draft from rekindle card compile)",
    "",
    "> A draft for your review. Edit it, keep what is true, delete the rest, then save it as your card.",
    `> ${WORKSHEET_WARNING}`,
    "",
    "## Core",
    "",
    "<!-- Write the few things every new agent must know first: how to talk to you, hard boundaries, what you value. -->",
    "",
  ];
  const section = (title: string, kind: EntryKind) => {
    const items = kept.filter((e) => e.kind === kind);
    if (items.length === 0) return;
    draft.push(`## ${title}`, "", ...items.map((e) => `- ${normalize(e.text)}`), "");
  };
  section("Preferences", "preference");
  section("Boundaries", "boundary");
  const about = kept.filter((e) => e.kind === "about");
  if (about.length > 0) draft.push("## About me (from identity.md)", "", ...about.map((e) => e.text), "");
  const projectEntries = kept.filter((e) => e.kind === "project");
  if (projectEntries.length > 0) {
    draft.push("## Current projects (confirm each is still active)", "");
    for (const name of [...new Set(projectEntries.map((e) => e.project as string))]) {
      draft.push(
        `### ${name}`,
        "",
        ...projectEntries
          .filter((e) => e.project === name)
          .map((e) => `- ${normalize(e.text)}${e.date ? ` (recorded ${e.date.slice(0, 10)})` : ""}`),
        ""
      );
    }
  }
  for (const imp of imported) draft.push(`## Imported: ${imp.name}`, "", imp.text, "");

  const worksheet: string[] = [
    "# Card worksheet (from rekindle card compile)",
    "",
    `> ${WORKSHEET_WARNING}`,
    "",
    `Compiled ${now.toISOString()}.`,
    "",
    "## Sources included",
    "",
    "- Preference and constraint records with no project.",
    ...opts.includeProjects.map((p) => `- Records for project: ${p}`),
    "- identity.md, section \"What I Know About My Person\".",
    ...imported.map((i) => `- Imported file: ${i.name}`),
    "",
    "## Sources not included or not read",
    "",
    ...(missing.length > 0 ? missing.map((m) => `- ${m}`) : ["- None among the sources compile knows about."]),
    "",
    "## Entries",
    "",
    "| Kind | Text | Source | Project | Date | Flags |",
    "|---|---|---|---|---|---|",
    ...entries.map(
      (e) => `| ${e.kind} | ${cell(e.text)} | ${cell(e.ref)} | ${e.project ? cell(e.project) : ""} | ${e.date ?? ""} | ${cell(e.flags.join("; "))} |`
    ),
    "",
  ];

  writeViaTemp(draftPath, draft.join("\n"), 0o600);
  try {
    writeViaTemp(worksheetPath, worksheet.join("\n"), 0o600);
  } catch (err) {
    throw new PartialWriteError(
      `${DRAFT_NAME} was written; ${WORKSHEET_NAME} failed: ${err instanceof Error ? err.message : String(err)}`,
      [draftPath],
      worksheetPath
    );
  }

  return { draftPath, worksheetPath, entries: kept.length, capped, missing };
}
