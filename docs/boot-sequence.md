# The Boot Sequence

## Why orientation matters

Most AI memory tools are passive: they store and retrieve on demand. The AI has to know what to ask for. If it doesn't ask, the memory might as well not exist.

Rekindle's boot sequence is proactive. At session start, the AI runs `boot_report` and receives a structured orientation: what it knows, what happened last time, what needs follow-up, and what it might be missing. It reports this to the human before any work begins.

## The pipeline

```
1. Identity     "Who am I working with?"
2. Memory scan  "What do I know?"
3. Checkpoint   "Where did we leave off?"
4. Transcript   "What actually happened last time?"
5. Open loops   "What needs follow-up?"
6. Captures     "Did I survive compaction?"
7. Gap check    "What am I missing?"
8. Score        "How oriented am I?"
```

### Step 1: Identity

The AI reads `.rekindle/identity.md`, a human-maintained document. This is the anchor. It describes the human's role, projects, preferences, values, and calibration notes. The identity document is human-written because the human knows who they are better than the AI does.

### Step 2: Memory scan

The boot report queries memory statistics: total count, breakdown by category and project, count of recent memories (last 7 days). This gives the AI a map of its knowledge without reading every memory.

### Step 3: Checkpoint

The most recent continuity record serves as a session-end summary from the last session. It typically contains 2-4 sentences: what was accomplished, current state, and next steps.

### Step 4: Transcript

The boot report finds and previews the most recent transcript from `.rekindle/transcripts/`. This is raw conversation, not a summary. The AI reads what actually happened and forms its own understanding, rather than relying on a compressed checkpoint.

### Step 5: Open loops

The boot report queries for `type='open_loop'` records — unresolved tasks, unanswered questions, or deferred decisions from prior sessions. These are surfaced explicitly so nothing falls through the cracks between sessions.

### Step 6: Captures

If PreCompact captures exist from a previous session (or from a prior compaction event in the current session), the boot report notes their presence. The AI can call `list_captures` and `read_capture` to recover context that compaction flattened.

### Step 7: Gap check

The boot report compares what was loaded against what a healthy memory state looks like:

- Is the identity document present and non-empty?
- Are any memory categories completely empty?
- Has anything been stored in the last 7 days?
- Are session transcripts available?
- Is a project scope configured?

Gaps are reported explicitly so the AI can acknowledge what it might be missing.

### Step 8: Orientation score

A transparent 100-point checklist:

```
Orientation Health: 85/100

+20  identity document loaded
+20  recent checkpoint exists
+20  transcript found
+15  recent memories exist (14 in last 7 days)
+10  relationship and preference categories populated
 -0  no gaps detected
```

Scoring is a simple weighted checklist. No mysticism. Users get a fast signal; we get something measurable over time.

## After boot

After running `boot_report`, the AI searches for memories relevant to the current task, then reports to the human:

> "Carrying forward: [what was loaded, what might be missing]"

This report happens before any work begins. The human knows exactly what the AI is working with and can correct or supplement as needed.

## Mid-session: surviving compaction

Long sessions (2+ hours) will eventually trigger context compaction, which compresses early conversation into a summary. What survives: conclusions and decisions. What dies: reasoning chains, failed approaches, exact wording, and tone.

The PreCompact hook fires automatically before compaction and saves what would otherwise be lost to `.rekindle/captures/`. After compaction, the model can call `list_captures` and `read_capture` to recover context — the tool descriptions are in the system prompt, which survives compaction.

For manual checkpointing at any point, call `capture_now` or use `store_memory` to save specific context.

## The session-end ritual

Good orientation depends on good session endings. The `end_session` tool captures structured continuity records while full context is still available:

1. **checkpoint** (required) — where we left off, 2-4 sentences
2. **decisions** — what was decided and why
3. **open_loops** — unresolved tasks or questions (surfaced in next boot)
4. **constraints** — boundaries that must not be violated
5. **preferences** — new user preferences learned
6. **warnings** — things next session should watch for
7. **next_session_focus** — where to resume

If PreCompact captures exist for the current session, `end_session` warns if they haven't been reviewed — ensuring the closing checkpoint is informed by the full session, not just the post-compaction remnant.
