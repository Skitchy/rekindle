# Rekindle README demo: a scripted MCP tool handoff, not a live model session.
# Session 1 ends with end_session; session 2, a new server process, loads that
# handoff with boot_report. Content is synthetic (see docs/demo/session.mjs).
#
# Recorded from main at 5ff9953 on 2026-10-19.
# Regenerate from the repo root:  vhs docs/demo.tape
# Writes only under /tmp/rekindle-demo: the packed tarball, a demo project,
# and an isolated HOME. Nothing from the recording machine's config is read.

Output docs/demo.gif

Set Shell "bash"
Set FontSize 13
Set Width 950
Set Height 980
Set Theme "Dracula"
Set Padding 16
Set TypingSpeed 35ms
Set WaitTimeout 240s

# Hidden setup: pack this checkout, install it and the MCP SDK into the demo
# project, copy the demo script in. The viewer sees none of this.
Hide
Type "REPO=$PWD && rm -rf /tmp/rekindle-demo && mkdir -p /tmp/rekindle-demo/home /tmp/rekindle-demo/project && npm pack --pack-destination /tmp/rekindle-demo >/dev/null 2>&1 && echo packed-ok"
Enter
Wait+Screen /packed-ok/
Type "export HOME=/tmp/rekindle-demo/home && cd /tmp/rekindle-demo/project && npm init -y >/dev/null && npm install --no-audit --no-fund --loglevel=error ../rekindle-*.tgz @modelcontextprotocol/sdk >/dev/null && cp $REPO/docs/demo/session.mjs . && echo setup-ok"
Enter
Wait+Screen /setup-ok/
Type "clear"
Enter
Show

Type "# Scripted MCP tool handoff, no live model. Session 1 ends, session 2 boots."
Enter
Sleep 2s

Type "npx rekindle init"
Enter
Sleep 5s

# Hidden: give the demo project a synthetic identity so boot_report has one to read.
Hide
Type "printf '# Identity Document\n\n## Voice and Style\nDirect and short.\n\n## What I Know About My Person\nSolo maintainer of breeze, a small weather CLI.\n\n## Active Context\nShipping the forecast cache this week.\n' > .rekindle/identity.md && clear"
Enter
Sleep 1s
Show

Type "node session.mjs end"
Enter
Sleep 5s

Type "clear"
Enter
Sleep 500ms

Type "node session.mjs boot"
Enter
Sleep 9s
