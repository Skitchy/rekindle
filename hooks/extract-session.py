#!/usr/bin/env python3
"""Extract a clean transcript from a Claude Code session JSONL.

Designed as a Claude Code Stop hook. Automatically finds the most recent
session and writes a Markdown transcript to .rekindle/transcripts/.

Usage:
  extract-session.py                      # most recent session
  extract-session.py <session-id>         # by session UUID
  extract-session.py /path/to/file.jsonl  # by explicit path

Configuration (environment variables):
  REKINDLE_TRANSCRIPT_DIR  Output directory (default: .rekindle/transcripts/)
  REKINDLE_SESSIONS_DIR    Claude Code sessions directory (auto-detected)
  REKINDLE_HUMAN_NAME      Name for human messages (default: Human)
  REKINDLE_AI_NAME         Name for AI messages (default: Assistant)
  REKINDLE_TIMEZONE        Timezone for timestamps (default: UTC)

Hook configuration for Claude Code (~/.claude/settings.json):
  {
    "hooks": {
      "Stop": [{
        "type": "command",
        "command": "python3 /path/to/rekindle/hooks/extract-session.py"
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
    # Auto-detect: ~/.claude/projects/-<cwd-with-dashes>/
    cwd_key = "-" + str(Path.cwd()).replace("/", "-")
    candidate = Path.home() / ".claude" / "projects" / cwd_key
    if candidate.is_dir():
        return candidate
    # Fallback: search all project dirs for most recent JSONL
    projects = Path.home() / ".claude" / "projects"
    if projects.is_dir():
        all_jsonls = sorted(projects.glob("*/*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
        if all_jsonls:
            return all_jsonls[0].parent
    sys.exit("Could not find Claude Code sessions directory. Set REKINDLE_SESSIONS_DIR.")


def get_transcript_dir() -> Path:
    env = os.environ.get("REKINDLE_TRANSCRIPT_DIR")
    if env:
        return Path(env)
    local = Path.cwd() / ".rekindle" / "transcripts"
    if local.parent.is_dir():
        return local
    global_dir = Path.home() / ".rekindle" / "transcripts"
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

# --- Extraction ---

def resolve_source(arg: str | None, sessions_dir: Path) -> Path:
    if arg is None:
        jsonls = sorted(sessions_dir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not jsonls:
            sys.exit(f"No session files found in {sessions_dir}")
        return jsonls[0]
    p = Path(arg)
    if p.exists():
        return p
    candidate = sessions_dir / f"{arg}.jsonl"
    if candidate.exists():
        return candidate
    sys.exit(f"Could not resolve session: {arg}")


def parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(LOCAL_TZ)


def extract_user_text(content) -> str | None:
    if isinstance(content, str):
        text = content.strip()
        return text or None
    return None


def extract_assistant_text(content) -> str | None:
    if not isinstance(content, list):
        return None
    parts = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            t = block.get("text", "").strip()
            if t:
                parts.append(t)
    joined = "\n\n".join(parts).strip()
    return joined or None


def extract(source: Path) -> tuple[str, datetime, str]:
    entries: list[tuple[datetime, str, str]] = []
    session_id = source.stem
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
            if kind == "user":
                text = extract_user_text(content)
                if text is None:
                    continue
                entries.append((ts, HUMAN_NAME, text))
            else:
                text = extract_assistant_text(content)
                if text is None:
                    continue
                entries.append((ts, AI_NAME, text))

    if not entries:
        sys.exit(f"No user/assistant messages found in {source}")

    start = entries[0][0]
    lines = [
        f"# Session Transcript — {start.strftime('%Y-%m-%d')}",
        f"Session: `{session_id}`",
        f"Start: {start.strftime('%Y-%m-%d %H:%M %Z')}",
        "",
    ]
    for ts, who, text in entries:
        lines.append(f"## {who} — {ts.strftime('%H:%M')}")
        lines.append("")
        lines.append(text)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n", start, session_id


def main(argv: list[str]) -> None:
    arg = argv[1] if len(argv) > 1 else None
    sessions_dir = get_sessions_dir()
    source = resolve_source(arg, sessions_dir)
    content, start, session_id = extract(source)
    dest_dir = get_transcript_dir()
    dest_dir.mkdir(parents=True, exist_ok=True)
    out = dest_dir / f"session-{start.strftime('%Y-%m-%d-%H%M%S')}.md"
    out.write_text(content)
    print(str(out))


if __name__ == "__main__":
    main(sys.argv)
