# The user card

A user card is one Markdown file about **you**, written so any AI agent can use it: how to talk to you, your boundaries, what you value, your current projects, what to avoid. Rekindle can load it at session start, so a new agent starts out knowing how you work instead of learning it again from scratch.

`identity.md` is about the agent ("who I am"). The user card is about the user. Keep the two apart: nothing agent-specific belongs on the card.

## Make one

Start from the template:

```bash
npx rekindle card template ~/user-card.md
```

Or draft one from what your agent has already learned, then review it and save the result as your card:

```bash
mkdir -p ~/card-draft
npx rekindle card compile --out ~/card-draft
# review ~/card-draft/card-draft.md, edit it, then save what you accept:
cp ~/card-draft/card-draft.md ~/user-card.md
```

`compile` needs an existing output directory. It reads the store it runs against and writes two files there, `card-draft.md` (the candidate card) and `card-worksheet.md` (a review sheet). It never creates or changes your card itself.

What it selects:

- **Records whose type is `preference` or `constraint`, or whose category is `preference`**, with no project, plus, with `--include-project <name>`, records for that project that match the same rule. That includes ordinary `store_memory` records filed under the `preference` category. Anything outside that rule is not read: an ordinary checkpoint (category `context`) is omitted, and so are other record types and categories. All selected records are read newest first, up to 2,000 in total; the worksheet says so if the cap was hit.
- **The "What I Know About My Person" section of `identity.md`**, without its template comments.
- **Files you pass with `--from <file.md>`**, for example reviewed notes from another agent. Their contents are copied into the draft verbatim, under their own heading.

What it does to the selected records and identity lines:

- collapses exact duplicates (same text after whitespace normalization);
- in the worksheet, marks dated records older than 180 days as possibly stale;
- under "Current projects (confirm each is still active)", keeps each project record's recorded date.

What it doesn't do:

- **Imported files are not processed.** They aren't deduplicated or dated, and the worksheet lists each one as a single entry, not line by line.
- **Identity lines and imports carry no date.**
- **It doesn't reliably detect contradictions, secrets or out-of-date facts.** Treat the draft as a list to review, not a finished card.

It refuses to write over your configured card (or any alias of it), and it stops if `policy.json` can't be read, because then it can't tell which file is your card.

## Load it at session start

```bash
npx rekindle card path ~/user-card.md
```

This sets `user_card_path` in the store's `.rekindle/policy.json` and changes nothing else. `REKINDLE_USER_CARD` overrides it (a blank value counts as unset). Relative paths in `policy.json` resolve against the store root.

**Setting the path doesn't make any client read the card by itself.** The card is part of Rekindle's orientation output, so it reaches an agent the same way the rest of that output does:

- **Claude Code:** install the SessionStart delivery hook with `npx rekindle setup-delivery` (see [Claude Code: session-start orientation](https://github.com/Skitchy/rekindle#claude-code-session-start-orientation-opt-in)). It is separate from the PreCompact capture hook; you don't need capture for the card.
- **Cursor:** the session-start adapter, `session-start --client cursor` (see [Cursor: session-start orientation](https://github.com/Skitchy/rekindle#cursor-session-start-orientation-opt-in)).
- **Any other MCP client:** the agent receives the card when it calls `boot_report`, or you arrange loading yourself.

With the default policy, the card is the first optional section after the required ones (identity, project, checkpoint, policy). A custom `policy.json` can classify sections differently, and optional sections listed before `user` in the delivery order then come first.

- The card is delivered **whole or not at all**. A card too big for the startup budget is left out, never truncated.
- A missing, empty, unreadable or too-large card never breaks startup.
- What happened to the card is recorded in the delivery receipt's `user_card` field (`included`, `dropped`, `missing`, `unreadable` or `empty`). That field contains only the source (env var or policy) and the status, never the card text or its path. Card diagnostics never appear in the packet.
- `boot_report` shows the same card.

If no card is configured, the card feature adds nothing: no card section in the packet and no `user_card` receipt field.

## One card, several agents

Every store you point at the same file shares one card. If several agents use the same store (for example, every host that resolves `~/.rekindle`), they all receive it.

Agents that run somewhere else, such as a cloud agent with its own computer, can't read a file on your machine. Give them a copy where their platform can read it (for example, a file in a cloud drive their connector reads) and tell them to read it at the start of a session. That copy is a snapshot: it doesn't update when you edit the original, so re-copy it after edits.

## Updating it

Agents suggest; you edit. A simple loop: ask agents to end a session with a short "Card suggestions:" list, and copy the lines you agree with into the card yourself. Local agents see the change at their next session start.

## Limits

- **The file is not locked.** Any agent with ordinary file access can edit the card or `policy.json`. Rekindle makes the card easy to share, not tamper-proof. Keep it somewhere you review.
- **Whatever is on the card goes to every agent that reads it**, including other vendors' agents. Put on it only what you'd tell a new collaborator.
- **Hosts may show startup text in their transcripts**, so card text can end up in a host's transcript like any other startup context.
