import type { OrientationResult } from "./types.js";
import { renderUserCardSection } from "../card/user-card.js";

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

    // Only a loaded card becomes a section. Missing, empty or unreadable cards are
    // reported in receipts, never in the packet, so a card problem adds no bytes.
    if (result.userCard?.status === "loaded" && result.userCard.content) {
      sections.set("user", renderUserCardSection(result.userCard.content));
    }

    if (result.project) {
      const label = result.project.project ?? "UNKNOWN PROJECT";
      sections.set(
        "project",
        `## Project Scope\n${label}\n\nResolution: ${result.project.rule}${result.project.override_registered !== null ? `\nOverride registered: ${result.project.override_registered ? "yes" : "no"}` : ""}${result.project.cwd ? `\nWorkspace: ${result.project.cwd}` : ""}`
      );
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

    if (result.transcript.mode === "excluded") {
      sections.set(
        "transcript",
        `## Last Session Transcript\nExcluded by policy; transcript files and paths were not read.`
      );
    } else if (result.transcript.mode === "tail-read-only" && result.transcript.exists && result.transcript.preview) {
      sections.set(
        "transcript",
        `## Last Session Transcript Tail\nFilename withheld by policy.\n\n${result.transcript.preview}`
      );
    } else if (result.transcript.exists && result.transcript.preview) {
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
        if (!item.applicable) return `N/A  ${item.label} (excluded by policy)`;
        if (item.earned) {
          return `+${String(item.points).padStart(2)}  ${item.label}`;
        }
        return ` ✗  ${item.label} (${item.points}pts)`;
      })
      .join("\n");
    sections.set(
      "score",
      `## Orientation Score\n${result.score}/100 (${result.scoreEarnedPoints}/${result.scorePossiblePoints} applicable points)\n\n${scoreLines}\n\nThis score is a structural checklist, not a guarantee that all relevant context was loaded.`
    );

    return sections;
  }

  static toMarkdown(result: OrientationResult): string {
    const sections = OrientationRenderer.toSections(result);
    // "user" is listed only when a card loaded, so output without a card is
    // unchanged (including the empty slot an absent project section leaves).
    const order = sections.has("user")
      ? ["identity", "user", "project", "memories", "checkpoint", "transcript", "gaps", "score"]
      : ["identity", "project", "memories", "checkpoint", "transcript", "gaps", "score"];
    return order
      .map((name) => sections.get(name) as string)
      .join("\n\n---\n\n");
  }

  static toJSON(result: OrientationResult): string {
    return JSON.stringify(result);
  }
}
