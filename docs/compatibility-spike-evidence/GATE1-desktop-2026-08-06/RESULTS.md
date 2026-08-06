# Gate 1 measurement results: explicit Desktop-safe storage-root behavior

Date: 2026-08-06. Client: Claude Desktop (macOS, version in ENVIRONMENT.txt). No cwd wrapper anywhere. Per-run server env sets HOME to a fixture directory so the real home is never a storage target (execution control 2). Live config pre-hashed, mutated by jq merge only, restored and verified byte-identical (execution control 4).

| Run | Build | Outcome |
|---|---|---|
| baseline-contrast | 7f09c85 (`3ab52fec...`) | Reproduces CD-M-01: client sends `initialize`, server dies on `mkdir '/.rekindle/db'` (ENOENT at cwd=/). Zero files created in fixture home. Disclosed same-day reproduction, not a new matrix case. |
| attempt1 | gate-1 (`68487b0a...`) | Full handshake: `initialize` answered, `notifications/initialized` received. Storage created at `<fixture home>/.rekindle/db/memories.db`. |
| attempt2 | gate-1 (`68487b0a...`) | Identical to attempt1. |

Verdict: gate 1 PASS, twice, with same-day crash contrast on the identical host and procedure. The gate-1 resolver (`REKINDLE_BASE_DIR` explicit, canonical `REKINDLE_DB_PATH` derivation, project detection with filesystem-root guard, home fallback, never the spawn point) is measured behavior on the client that motivated the gate.

Privacy: raw slices and live-config derivatives are withheld (PATH toolchain inventory, maintainer settings); published files are redacted derivatives with dual-hash provenance in `DERIVATIONS.json` and withholding reasons in `WITHHELD.json`. Originals retained maintainer-private, producible on request. Evidence gate PASS over this tree.

Not measured here: gates 2-4 remain open; gate 5 implementation remains open. This artifact closes gate 1 only.
