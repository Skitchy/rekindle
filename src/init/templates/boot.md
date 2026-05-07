## Rekindle: Session Orientation

At the start of every session, before any work:

1. Call `boot_report` with your identity_path and transcript_dir to get an orientation summary
2. Read the report: identity status, memory count, last session context, detected gaps
3. Search memories for terms relevant to today's task using `search_memory`
4. Report to the user: "Carrying forward: [what you loaded, what might be missing]"

At the end of every substantive session:
1. Call `end_session` with:
   - checkpoint: where we left off (required)
   - decisions: what was decided and why
   - open_loops: unresolved tasks or questions
   - preferences: new user preferences learned
   - constraints: boundaries that must not be violated
   - warnings: things the next session should be careful about
   - relational_delta: what changed in the working relationship
   - next_session_focus: where to resume next session
   - project: active project scope
   - transcript_path: path to transcript file, if available
2. Review identity.md and update if anything identity-relevant changed
