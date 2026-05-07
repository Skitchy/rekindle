import type { OrientationResult } from "./types.js";

export class OrientationRenderer {
  static toMarkdown(result: OrientationResult): string {
    const sections: string[] = [];

    if (result.identity.loaded && result.identity.content) {
      sections.push(
        `## Identity\nLoaded from ${result.identity.path}\n\n${result.identity.content}`
      );
    } else {
      sections.push(`## Identity\nNot found at ${result.identity.path}`);
    }

    const catBreakdown = Object.entries(result.memoryStats.byCategory)
      .map(([cat, count]) => `  ${cat}: ${count}`)
      .join("\n");
    const projBreakdown = Object.entries(result.memoryStats.byProject)
      .map(([proj, count]) => `  ${proj}: ${count}`)
      .join("\n");

    sections.push(
      `## Memories\n${result.memoryStats.total} total (${result.memoryStats.recentCount} in last 7 days)\n\nBy category:\n${catBreakdown || "  (none)"}\n\nBy project:\n${projBreakdown || "  (none)"}`
    );

    if (result.checkpoint.exists && result.checkpoint.content) {
      sections.push(
        `## Last Checkpoint\n${result.checkpoint.created_at}\n\n${result.checkpoint.content}`
      );
    } else {
      sections.push(`## Last Checkpoint\nNone found`);
    }

    if (result.transcript.exists && result.transcript.preview) {
      sections.push(
        `## Last Session Transcript\n${result.transcript.name}\n\n${result.transcript.preview}`
      );
    } else {
      sections.push(
        `## Last Session Transcript\nNo transcripts found in transcript directory`
      );
    }

    if (result.gaps.length > 0) {
      sections.push(
        `## Gaps Detected\n${result.gaps.map((g) => `- ${g.message}`).join("\n")}`
      );
    } else {
      sections.push(`## Gaps Detected\nNone. Orientation looks complete.`);
    }

    const scoreLines = result.scoreBreakdown
      .map((item) => {
        const pts = item.earned
          ? `+${String(item.points).padStart(2)}`
          : ` +0`;
        return `${pts}  ${item.label}`;
      })
      .join("\n");
    sections.push(
      `## Orientation Score\n${result.score}/100\n\n${scoreLines}\n\nThis score is a structural checklist, not a guarantee that all relevant context was loaded.`
    );

    return sections.join("\n\n---\n\n");
  }

  static toJSON(result: OrientationResult): string {
    return JSON.stringify(result);
  }
}
