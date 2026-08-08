import type { OrientationResult } from "./types.js";

export class OrientationRenderer {
  /**
   * Named sections, so callers with a byte budget (delivery/budget.ts) can
   * prioritize and truncate per section. toMarkdown composes from this map;
   * both views render identical section text.
   */
  static toSections(result: OrientationResult): Map<string, string> {
    const sections = new Map<string, string>();

    if (result.identity.loaded && result.identity.content) {
      sections.set(
        "identity",
        `## Identity\nLoaded from ${result.identity.path}\n\n${result.identity.content}`
      );
    } else {
      sections.set("identity", `## Identity\nNot found at ${result.identity.path}`);
    }

    const catBreakdown = Object.entries(result.memoryStats.byCategory)
      .map(([cat, count]) => `  ${cat}: ${count}`)
      .join("\n");
    const projBreakdown = Object.entries(result.memoryStats.byProject)
      .map(([proj, count]) => `  ${proj}: ${count}`)
      .join("\n");

    sections.set(
      "memories",
      `## Memories\n${result.memoryStats.total} total (${result.memoryStats.recentCount} in last 7 days)\n\nBy category:\n${catBreakdown || "  (none)"}\n\nBy project:\n${projBreakdown || "  (none)"}`
    );

    if (result.checkpoint.exists && result.checkpoint.content) {
      sections.set(
        "checkpoint",
        `## Last Checkpoint\n${result.checkpoint.created_at}\n\n${result.checkpoint.content}`
      );
    } else {
      sections.set("checkpoint", `## Last Checkpoint\nNone found`);
    }

    if (result.transcript.exists && result.transcript.preview) {
      sections.set(
        "transcript",
        `## Last Session Transcript\n${result.transcript.name}\n\n${result.transcript.preview}`
      );
    } else {
      sections.set(
        "transcript",
        `## Last Session Transcript\nNo transcripts found in transcript directory`
      );
    }

    if (result.gaps.length > 0) {
      sections.set(
        "gaps",
        `## Gaps Detected\n${result.gaps.map((g) => `- [${g.severity}] ${g.code}: ${g.message}`).join("\n")}`
      );
    } else {
      sections.set("gaps", `## Gaps Detected\nNone. Orientation looks complete.`);
    }

    const scoreLines = result.scoreBreakdown
      .map((item) => {
        if (item.earned) {
          return `+${String(item.points).padStart(2)}  ${item.label}`;
        }
        return ` ✗  ${item.label} (${item.points}pts)`;
      })
      .join("\n");
    sections.set(
      "score",
      `## Orientation Score\n${result.score}/100\n\n${scoreLines}\n\nThis score is a structural checklist, not a guarantee that all relevant context was loaded.`
    );

    return sections;
  }

  static toMarkdown(result: OrientationResult): string {
    const sections = OrientationRenderer.toSections(result);
    return ["identity", "memories", "checkpoint", "transcript", "gaps", "score"]
      .map((name) => sections.get(name) as string)
      .join("\n\n---\n\n");
  }

  static toJSON(result: OrientationResult): string {
    return JSON.stringify(result);
  }
}
