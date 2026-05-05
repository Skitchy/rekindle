# The Boot Sequence

## Why orientation matters

Most AI memory tools are passive: they store and retrieve on demand. The AI has to know what to ask for. If it doesn't ask, the memory might as well not exist.

Rekindle's boot sequence is proactive. At session start, the AI runs `boot_report` and receives a structured orientation: what it knows, what happened last time, and what it might be missing. It reports this to the human before any work begins.

## The pipeline

```
1. Identity     "Who am I working with?"
2. Memory scan  "What do I know?"
3. Checkpoint   "Where did we leave off?"
4. Transcript   "What actually happened last time?"
5. Gap check    "What am I missing?"
```

### Step 1: Identity

The AI reads `.rekindle/identity.md`, a human-maintained document. This is the anchor. It describes the human's role, projects, preferences, values, and calibration notes. The identity document is human-written because the human knows who they are better than the AI does.

### Step 2: Memory scan

The boot report queries memory statistics: total count, breakdown by category and project, count of recent memories (last 7 days). This gives the AI a map of its knowledge without reading every memory.

### Step 3: Checkpoint

The most recent `context` category memory serves as a session-end summary from the last session. It typically contains 2-4 sentences: what was accomplished, current state, and next steps.

### Step 4: Transcript

The boot report finds and previews the most recent transcript from `.rekindle/transcripts/`. This is raw conversation, not a summary. The AI reads what actually happened and forms its own understanding, rather than relying on a compressed checkpoint.

### Step 5: Gap check

The boot report compares what was loaded against what a healthy memory state looks like:

- Is the identity document present and non-empty?
- Are any memory categories completely empty?
- Has anything been stored in the last 7 days?
- Are session transcripts available?

Gaps are reported explicitly so the AI can acknowledge what it might be missing.

## After boot

After running `boot_report`, the AI searches for memories relevant to the current task, then reports to the human:

> "Carrying forward: [what was loaded, what might be missing]"

This report happens before any work begins. The human knows exactly what the AI is working with and can correct or supplement as needed.

## The session-end ritual

Good orientation depends on good session endings. At the end of each session:

1. Store a checkpoint (category: `context`, importance: 7, 2-4 sentences)
2. Update the identity document if anything identity-relevant changed
3. The session capture hook (if configured) extracts the transcript automatically

The checkpoint and transcript become the foundation for the next session's boot report.
