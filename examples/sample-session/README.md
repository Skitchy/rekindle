# Sample Session

This is what a `.rekindle/` directory looks like after a week of use.

## Contents

```
.rekindle/
  identity.md              ← Filled-in identity document
  db/                      ← SQLite database (not included — generated on init)
  transcripts/
    session-2026-05-04-213000.md  ← Last session transcript
```

`example-boot-report.md` shows the output of `boot_report` — what the AI sees at the start of session 8, and what it sees on session 1 for comparison.

## The Scenario

A senior backend engineer building a Rust ingestion service. After 7 sessions:

- 14 memories stored across 3 projects
- Identity document describes their working style and preferences
- Last session transcript preserves the full backpressure implementation discussion
- Boot report loads all of this and detects no gaps

The AI starts session 8 knowing who it's working with, what happened last time, and what's pending. No re-explanation needed.

## Try It

```bash
# Initialize your own project
cd your-project
node /path/to/rekindle/dist/init/cli.js init

# Fill in .rekindle/identity.md with your details
# Add the MCP server to your Claude Code config (see main README)
# Start a session — boot_report will be sparse at first
# After a few sessions, it looks like example-boot-report.md
```
