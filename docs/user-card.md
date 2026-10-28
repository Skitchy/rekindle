# The user card

A user card is one Markdown file about **you**, written so any AI agent can use it: how to talk to you, your boundaries, what you value, your current projects, what to avoid. Rekindle can load it at session start, so a new agent starts out knowing how you work instead of learning it again from scratch.

`identity.md` is about the agent ("who I am"). The user card is about the user. Keep the two apart: nothing agent-specific belongs on the card.

## Make one

Start from the template:

```bash
npx rekindle card template ~/user-card.md
```

Or draft one from what your agent has already learned:

```bash
npx rekindle card compile --out ~/card-draft
```

`compile` reads the store it runs against and writes two files:

- `card-draft.md`: the candidate card.
- `card-worksheet.md`: each candidate line with its source record, date and project, plus anything it flagged.

What it reads:

- preference and constraint records that have no project;
- the "What I Know About My Person" section of `identity.md`;
- records for projects you name with `--include-project <name>` (each line keeps its recorded date, under a "confirm each is still active" heading);
- reviewed Markdown files you pass with `--from <file.md>`, for example notes from another agent.

It is deterministic and runs no model. It collapses exact duplicates and marks entries older than 180 days. It does **not** detect contradictions, secrets or out-of-date facts reliably, so treat the draft as a list to review, not a finished card. It refuses to write over your configured card (or any alias of it), and it stops if `policy.json` can't be read, because then it can't tell which file is your card.

## Load it at session start

```bash
npx rekindle card path ~/user-card.md
```

This sets `user_card_path` in the store's `.rekindle/policy.json` and changes nothing else. `REKINDLE_USER_CARD` overrides it (a blank value counts as unset). Relative paths in `policy.json` resolve against the store root.

At session start the card is the first optional section after the required ones (identity, project, checkpoint, policy):

- It is delivered **whole or not at all**. A card too big for the startup budget is left out, never truncated.
- A missing, empty, unreadable or too-large card never breaks startup.
- What happened to the card is recorded in the delivery receipt as `user_card` (`included`, `dropped`, `missing`, `unreadable` or `empty`), never in the packet. Receipts carry no card text and no path.
- `boot_report` shows the same card.

With no card configured, the startup packet and receipt are exactly what they were before.

## One card, several agents

Every store you point at the same file shares one card. If several agents use the same store (for example, every host that resolves `~/.rekindle`), they all receive it.

Agents that run somewhere else, such as a cloud agent with its own computer, can't read a file on your machine. Give them a copy where their platform can read it (for example, a file in a cloud drive their connector reads) and tell them to read it at the start of a session. That copy is a snapshot: it doesn't update when you edit the original, so re-copy it after edits.

## Updating it

Agents suggest; you edit. A simple loop: ask agents to end a session with a short "Card suggestions:" list, and copy the lines you agree with into the card yourself. Local agents see the change at their next session start.

## Limits

- **The file is not locked.** Any agent with ordinary file access can edit the card or `policy.json`. Rekindle makes the card easy to share, not tamper-proof. Keep it somewhere you review.
- **Whatever is on the card goes to every agent that reads it**, including other vendors' agents. Put on it only what you'd tell a new collaborator.
- **Hosts may show startup text in their transcripts**, so card text can end up in a host's transcript like any other startup context.
