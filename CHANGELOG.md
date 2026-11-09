# Changelog

All notable changes to Rekindle are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Rekindle uses [Semantic Versioning](https://semver.org/). Full notes for each release are on the [GitHub releases page](https://github.com/Skitchy/rekindle/releases).

## [Unreleased]

## [0.5.1] - TBD

### Fixed
- A user card you never filled in is no longer delivered. It is left out of the session-start packet and `boot_report`, and the receipt reports `unfilled`. A line beyond the shipped template and plain one-line comments makes the card eligible for whole-card delivery; existing size and budget limits still apply. Text inside a plain one-line HTML comment (`<!-- like this -->`) does not count as filling in the card. Multi-line or ambiguous comment lines count as content. ([#38](https://github.com/Skitchy/rekindle/issues/38), [#41](https://github.com/Skitchy/rekindle/pull/41))
- `rekindle init --global` no longer creates or changes `~/.gitignore`. Project init still adds `.rekindle/` to that project's `.gitignore`. ([#26](https://github.com/Skitchy/rekindle/issues/26), [#40](https://github.com/Skitchy/rekindle/pull/40))

### Security
- The lockfile now resolves `@hono/node-server` 2.1.6 (from 2.0.12), clearing a moderate advisory ([GHSA-rmxm-3fg6-px4f](https://github.com/advisories/GHSA-rmxm-3fg6-px4f)) reported by `npm audit --omit=dev`. This repairs this repository's CI and installs from a clone. npm does not publish the lockfile, so it does not pin the patched version for people who install the package; their npm resolves it from the MCP SDK's own range. ([#39](https://github.com/Skitchy/rekindle/pull/39))

## [0.5.0] - 2026-10-28

### Added
- The user card: one Markdown file about you that any agent can read at session start (how to talk to you, boundaries, projects, what to avoid). `rekindle card template`, `rekindle card compile`, and `rekindle card path` (or `init --card`). Opt-in, delivered whole or not at all, and a missing or oversized card never breaks startup. See [docs/user-card.md](docs/user-card.md). ([#32](https://github.com/Skitchy/rekindle/pull/32))

### Changed
- A capture made where no project resolves is now untagged (`project: null`, with a warning) instead of labelled with the folder name.
- The score line now reads "Identity document filled in", and fresh installs score 20 points lower until `identity.md` is filled in.

### Fixed
- Transcript discovery stays in the current workspace. ([#29](https://github.com/Skitchy/rekindle/issues/29))
- `capture_now` never pairs a transcript with another session's id. ([#28](https://github.com/Skitchy/rekindle/issues/28))
- Captures are tagged with the resolved project, never a guessed one. ([#30](https://github.com/Skitchy/rekindle/issues/30))
- An unfilled identity template no longer earns the identity points. ([#31](https://github.com/Skitchy/rekindle/issues/31))

## [0.4.1] - 2026-10-24

### Fixed
- `--global` hook setup now writes `~/.claude/settings.json`, the user-scope file Claude Code actually reads, instead of `~/.claude/settings.local.json`. If you ran a `--global` setup on 0.4.0, see the [0.4.1 release notes](https://github.com/Skitchy/rekindle/releases/tag/v0.4.1) to move your hooks. ([#25](https://github.com/Skitchy/rekindle/issues/25))

### Changed
- The unresolved-workspace warning names the remedy (add the workspace to `.rekindle/projects.json` or set `REKINDLE_PROJECT`).
- `init` output matches the README.

## [0.4.0] - 2026-10-20

### Breaking
- Requires Node.js 22 or newer. CI runs on Node 22, 24 and 26.

### Added
- Policy-aware session start through `.rekindle/policy.json` (transcript mode, startup byte budget, mandatory and optional sections, background writes).
- Project-safe delivery through `.rekindle/projects.json`. An unmapped or ambiguous workspace is reported as `UNKNOWN PROJECT` and never receives another project's checkpoint. `REKINDLE_PROJECT` is an explicit override.
- Signed provenance chain groundwork (canonicalization, signing keys, semantic write gate, chain write path).
- CONTRIBUTING.md and a re-recorded demo GIF.

### Changed
- The npm tarball drops from about 1.9 MB to about 110 KB. Evidence and design documents stay on GitHub.
- Transcript filename is withheld in `tail-read-only` mode.

### Fixed
- A session row and its audit row now commit together or not at all.
- Production `npm audit` findings cleared.

## [0.3.3] - 2026-08-09

### Fixed
- MCP `serverInfo.version` is derived from the shipped `package.json`, so the reported version can't drift from the release.

## [0.3.2] - 2026-08-09

### Added
- `npx rekindle setup-delivery` (and `init --with-delivery`) installs the SessionStart delivery hook. Plain `init` still installs nothing.

## [0.3.1] - 2026-08-08

### Added
- Cursor session-start adapter (`rekindle session-start --client cursor`) with a privacy-safe receipt path.
- Workflow guidance rides MCP tool descriptions as well as the instructions field.

### Changed
- Session-start packets cap at 8,000 UTF-8 bytes with a truncation marker.
- Orientation re-delivers after `/clear` and `/compact`.

### Fixed
- No crash when launched at `cwd=/` (Claude Desktop's MCP launch behavior).
- Plain `init` no longer auto-installs hooks.

## [0.3.0] - 2026-05-08

### Added
- PreCompact capture system: a raw transcript plus a structured snapshot saved before context compaction, with summary, structured, and raw read modes.
- New tools `list_captures`, `read_capture`, and `capture_now`.
- `boot_report` surfaces open loops from earlier sessions.
- `npx rekindle setup-hooks` (and `init --with-hooks`).

## 0.2.1 - 2026-05-07

### Added
- MCP Registry metadata and `mcp.json` for Cursor Directory compatibility.
- Multi-client install configs and a Dockerfile for Glama.

## [0.2.0] - 2026-05-07

### Added
- Orientation domain layer behind `boot_report`, with a transparent 100-point score and structured gaps (code, severity, message).
- `end_session` tool for a structured session close.
- Typed continuity records and session tracking. The schema migrates automatically from 0.1.

## 0.1.1 - 2026-05-07

### Changed
- npm publish packaging and Windows/WSL2 guidance.

## [0.1.0] - 2026-05-06

### Added
- First release: an MCP memory server with local SQLite and FTS5 search, six tools including `boot_report`, structural gap detection, and the `init` scaffold.

[Unreleased]: https://github.com/Skitchy/rekindle/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/Skitchy/rekindle/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/Skitchy/rekindle/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/Skitchy/rekindle/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/Skitchy/rekindle/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/Skitchy/rekindle/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/Skitchy/rekindle/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Skitchy/rekindle/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Skitchy/rekindle/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Skitchy/rekindle/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Skitchy/rekindle/releases/tag/v0.1.0
