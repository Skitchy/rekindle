#!/usr/bin/env python3
"""Capture recent session exchanges before context compaction.

Reads the active session JSONL and saves the last N user/assistant
exchanges to a capture file. Each compaction event creates a new
numbered capture, preserving relational texture that compaction
would otherwise flatten.

Captures land in .rekindle/captures/<session-id>/

Configuration (environment variables):
  REKINDLE_SESSIONS_DIR    Claude Code sessions directory (auto-detected)
  REKINDLE_CAPTURES_DIR    Output directory (default: .rekindle/captures/)
  REKINDLE_HUMAN_NAME      Name for human messages (default: Human)
  REKINDLE_AI_NAME         Name for AI messages (default: Assistant)
  REKINDLE_TIMEZONE        Timezone for timestamps (default: UTC)
  REKINDLE_TAIL_COUNT      Number of messages to capture (default: 80)

Hook configuration for Claude Code (~/.claude/settings.json):
  {
    "hooks": {
      "PreCompact": [{
        "type": "command",
        "command": "python3 /path/to/rekindle/hooks/pre-compact-capture.py"
      }]
    }
  }
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None  # type: ignore[misc,assignment]

# --- Configuration ---

def get_sessions_dir() -> Path:
    env = os.environ.get("REKINDLE_SESSIONS_DIR")
    if env:
        return Path(env)
    cwd_key = "-" + str(Path.cwd()).replace("/", "-")
    candidate = Path.home() / ".claude" / "projects" / cwd_key
    if candidate.is_dir():
        return candidate
    projects = Path.home() / ".claude" / "projects"
    if projects.is_dir():
        all_jsonls = sorted(projects.glob("*/*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
        if all_jsonls:
            return all_jsonls[0].parent
    sys.exit("Could not find Claude Code sessions directory. Set REKINDLE_SESSIONS_DIR.")


def get_captures_dir() -> Path:
    env = os.environ.get("REKINDLE_CAPTURES_DIR")
    if env:
        return Path(env)
    local = Path.cwd() / ".rekindle" / "captures"
    if local.parent.is_dir():
        return local
    global_dir = Path.home() / ".rekindle" / "captures"
    if global_dir.parent.is_dir():
        return global_dir
    return local


def get_timezone():
    tz_name = os.environ.get("REKINDLE_TIMEZONE", "UTC")
    if ZoneInfo is not None:
        return ZoneInfo(tz_name)
    return timezone.utc


HUMAN_NAME = os.environ.get("REKINDLE_HUMAN_NAME", "Human")
AI_NAME = os.environ.get("REKINDLE_AI_NAME", "Assistant")
LOCAL_TZ = get_timezone()
TAIL_COUNT = int(os.environ.get("REKINDLE_TAIL_COUNT", "80"))

# --- Capture ---

def find_active_session(sessions_dir: Path) -> Path:
    jsonls = sorted(
        sessions_dir.glob("*.jsonl"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not jsonls:
        sys.exit("No session files found")
    return jsonls[0]


def parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(LOCAL_TZ)


def extract_text(content) -> str | None:
    if isinstance(content, str):
        return content.strip() or None
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                t = block.get("text", "").strip()
                if t:
                    parts.append(t)
        joined = "\n\n".join(parts).strip()
        return joined or None
    return None


def main():
    sessions_dir = get_sessions_dir()
    source = find_active_session(sessions_dir)
    session_id = source.stem

    entries: list[tuple[datetime, str, str]] = []
    with source.open() as f:
        for raw in f:
            raw = raw.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if obj.get("isSidechain"):
                continue
            kind = obj.get("type")
            if kind not in ("user", "assistant"):
                continue
            msg = obj.get("message", {})
            content = msg.get("content")
            ts_raw = obj.get("timestamp")
            if not ts_raw:
                continue
            ts = parse_ts(ts_raw)
            text = extract_text(content)
            if text is None:
                continue
            who = HUMAN_NAME if kind == "user" else AI_NAME
            entries.append((ts, who, text))

    if not entries:
        return

    tail = entries[-TAIL_COUNT:]

    captures_dir = get_captures_dir()
    session_dir = captures_dir / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    existing = sorted(session_dir.glob("compact-*.md"))
    n = len(existing) + 1

    now = datetime.now(LOCAL_TZ)
    lines = [
        f"# Pre-Compaction Capture #{n}",
        f"Session: `{session_id}`",
        f"Captured: {now.strftime('%Y-%m-%d %H:%M %Z')}",
        f"Exchanges: {len(tail)} (of {len(entries)} total)",
        "",
        "---",
        "",
    ]
    for ts, who, text in tail:
        lines.append(f"## {who} — {ts.strftime('%H:%M')}")
        lines.append("")
        lines.append(text)
        lines.append("")

    out = session_dir / f"compact-{n:02d}.md"
    out.write_text("\n".join(lines).rstrip() + "\n")
    print(f"Captured {len(tail)} exchanges to {out}")


if __name__ == "__main__":
    main()
