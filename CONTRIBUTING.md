# Contributing to Rekindle

Thanks for your interest. Rekindle is small and deliberate, and contributions that keep it that way are welcome.

## Requirements

Node.js 22 or newer. CI runs on Node 22, 24 and 26.

## Setup

```bash
git clone https://github.com/Skitchy/rekindle.git
cd rekindle
npm ci
```

## Checks

Run these before opening a pull request. All three must pass.

```bash
npm test
npm run build
npm run verify:package
```

`verify:package` packs the package, installs it into a fresh project, runs `init`, confirms that plain `init` installs no hooks, exercises both hook installers, and checks that the MCP server reports the same version as `package.json`.

## Pull requests

- Add or update tests for any behavior change. The suite is in `src/**/__tests__/`.
- CI must be green on Node 22, 24 and 26, including the clean-install jobs, which install the packed tarball in containers with no compiler.
- No personal data in tests, fixtures, docs or evidence: no real names, email addresses, user or workspace paths, transcripts, or other personal context. Synthetic or temporary paths in tests are fine.
- Keep the change narrow. One concern per pull request.
- Please commit with a GitHub noreply address as the author email. This repository keeps personal addresses out of its history.

## Reporting issues

Use the issue templates on GitHub:

- **Bug Report** for something that does not work as documented.
- **Continuity Failure Report** for a case where Rekindle failed to preserve context across sessions. These reports are research data for the project.
- **Installation Help** for trouble installing or configuring Rekindle.

## License

Rekindle is released under the MIT License (see `LICENSE`). Contributions are distributed under the same license.
