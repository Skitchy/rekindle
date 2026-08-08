/**
 * Hook-output budget enforcement.
 *
 * Origin (CC-H-07, compatibility spike 2026-08-03): when a SessionStart hook
 * emits more than the host accepts, Claude Code silently externalizes the
 * over-limit output to session storage — the model sees only a leading
 * portion, with no stderr and no error. A packet must therefore be BORN
 * within budget; nothing downstream will warn us.
 *
 * The budget is enforced in UTF-8 bytes, never characters, and truncation
 * never splits a multi-byte code point.
 */

export const HOOK_BUDGET_BYTES = 8000;

const SEPARATOR = "\n\n";
const TRUNCATION_MARKER =
  "\n[rekindle: section truncated to fit the hook output budget]";
/** Below this many content bytes a truncated section is noise; drop instead. */
const MIN_TRUNCATED_CONTENT_BYTES = 64;

export interface PacketSection {
  /** Stable section name, e.g. "identity", "checkpoint". */
  name: string;
  content: string;
}

export interface SectionDisposition {
  name: string;
  disposition: "included" | "truncated" | "dropped";
  /** Bytes of this section actually present in the emitted packet. */
  emitted_bytes: number;
  /** Bytes the section would have occupied unbudgeted. */
  full_bytes: number;
}

export interface BudgetedPacket {
  text: string;
  bytes: number;
  budget_bytes: number;
  sections: SectionDisposition[];
}

function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf-8");
}

/** Truncate to at most maxBytes of valid UTF-8, never splitting a code point. */
export function truncateUtf8(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, "utf-8");
  if (buf.length <= maxBytes) return s;
  if (maxBytes <= 0) return "";
  let end = maxBytes;
  // Back off any continuation bytes (0b10xxxxxx) so the cut lands on a boundary.
  while (end > 0 && (buf[end] & 0b11000000) === 0b10000000) end--;
  return buf.subarray(0, end).toString("utf-8");
}

/**
 * Assemble sections, in the given priority order, into a packet guaranteed to
 * fit the budget. Greedy in priority order: a section that does not fit whole
 * is truncated (with an explicit in-packet marker) when enough room remains
 * for a useful fragment, otherwise dropped; later, smaller sections may still
 * fill remaining room. The returned text is always <= budget_bytes.
 */
export function budgetPacket(
  sections: PacketSection[],
  budgetBytes: number = HOOK_BUDGET_BYTES
): BudgetedPacket {
  const parts: string[] = [];
  const dispositions: SectionDisposition[] = [];
  let used = 0;

  for (const section of sections) {
    const fullBytes = byteLength(section.content);
    const sepBytes = parts.length > 0 ? byteLength(SEPARATOR) : 0;
    const remaining = budgetBytes - used - sepBytes;

    if (fullBytes <= remaining) {
      parts.push(section.content);
      used += sepBytes + fullBytes;
      dispositions.push({
        name: section.name,
        disposition: "included",
        emitted_bytes: fullBytes,
        full_bytes: fullBytes,
      });
      continue;
    }

    const markerBytes = byteLength(TRUNCATION_MARKER);
    const contentRoom = remaining - markerBytes;
    if (contentRoom >= MIN_TRUNCATED_CONTENT_BYTES) {
      const truncated = truncateUtf8(section.content, contentRoom) + TRUNCATION_MARKER;
      const emitted = byteLength(truncated);
      parts.push(truncated);
      used += sepBytes + emitted;
      dispositions.push({
        name: section.name,
        disposition: "truncated",
        emitted_bytes: emitted,
        full_bytes: fullBytes,
      });
    } else {
      dispositions.push({
        name: section.name,
        disposition: "dropped",
        emitted_bytes: 0,
        full_bytes: fullBytes,
      });
    }
  }

  const text = parts.join(SEPARATOR);
  const bytes = byteLength(text);
  if (bytes > budgetBytes) {
    // Structural invariant; if this ever throws, the budgeter itself is broken.
    throw new Error(
      `budgetPacket invariant violated: ${bytes} > ${budgetBytes} bytes`
    );
  }
  return { text, bytes, budget_bytes: budgetBytes, sections: dispositions };
}
