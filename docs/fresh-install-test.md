# Fresh Install Test — v0.1.0

Tested: 2026-05-05
OS: macOS 15.5 (Darwin 25.4.0)
Node: v22.22.0
npm: 11.11.0

## Steps and Results

### 1. Clone

```bash
git clone https://github.com/Skitchy/rekindle.git
cd rekindle
```

Result: Clean clone, no errors.

### 2. Install

```bash
npm install
```

Result: 179 packages installed. One deprecation warning (`prebuild-install`). 3 moderate severity vulnerabilities (all in dev dependencies, none affect runtime).

### 3. Build

```bash
npm run build
```

Result: Clean TypeScript compilation. Templates copied to dist/init/templates/.

### 4. Test

```bash
npm test
```

Result: 37 tests passed (2 test files). Duration ~250ms.

### 5. Init in fresh directory

```bash
mkdir /tmp/test-project && cd /tmp/test-project
node /path/to/rekindle/dist/init/cli.js init
```

Result:
- `.rekindle/db/memories.db` created (36KB with schema)
- `.rekindle/identity.md` created (template with placeholder sections)
- `.rekindle/transcripts/` created (empty)
- `.gitignore` created with `.rekindle/` entry
- Boot instructions printed (CLAUDE.md paste block)
- MCP config printed (uses `node` with absolute path to dist/index.js)

### 6. Verify generated MCP config

The MCP config uses `node` + absolute path (correct — not `npx` since package isn't published).
`REKINDLE_DB_PATH` env var points to the correct `.rekindle/db/memories.db`.

### 7. README accuracy

- Demo GIF loads: yes (docs/demo.gif, 156KB)
- Install steps match: yes (clone, npm install, npm run build, init)
- Tool descriptions match actual behavior: yes
- Privacy warning about unsandboxed boot_report paths: yes (Privacy section)
- Roadmap separates v0.1 from v0.2: yes (What's Built / What's Next sections)
- Examples link works: yes (examples/sample-session/)

## Issues Found and Fixed

1. **`.gitignore` not created for projects without one** — `scaffold.ts` only appended to existing `.gitignore`. Fixed: now creates `.gitignore` if none exists.

## Checklist

- [x] `npm install && npm run build && npm test` passes
- [x] `node dist/init/cli.js init` works in a fresh test directory
- [x] Generated MCP config uses `node`, not `npx`
- [x] `.rekindle/` gets added to `.gitignore`
- [x] Privacy warning about unsandboxed boot_report paths is visible
- [x] Roadmap separates v0.1 from v0.2
- [x] README examples match implemented output
- [x] Demo GIF loads
- [x] Identity template is clear and fillable
- [x] Boot instructions are copy-pasteable
