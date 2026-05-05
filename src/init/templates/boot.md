## Rekindle: Session Orientation

At the start of every session, before any work:

1. Call `boot_report` with your identity_path and transcript_dir to get an orientation summary
2. Read the report: identity status, memory count, last session context, detected gaps
3. Search memories for terms relevant to today's task using `search_memory`
4. Report to the user: "Carrying forward: [what you loaded, what might be missing]"

At the end of every substantive session:
1. Store a session checkpoint using `store_memory` (category: context, importance: 7)
   Include: what was accomplished, current state, and next steps (2-4 sentences)
2. Review identity.md and update if anything identity-relevant changed
