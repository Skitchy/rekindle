# Withheld artifacts (originals retained locally, producible privately)

Withholding rule: no public artifact is copied from a live personal
environment; artifacts made of the maintainer's personal context ship as
redacted derivatives with a DERIVATIONS chain, or not at all. Sanitized text
copies in this tree replace the maintainer's home directory with <HOME>.

- gate2-desktop: navigation/working captures view-01..06, view-10, view-11*
  (Desktop Code-tab environment and sidebar chat titles in frame);
  config-used.json (derived from the live Desktop config; the swap is fully
  described by gate2-desktop.sh and capture-log.txt hashes); the raw
  uncropped originals of the published derivatives (hashes in
  DERIVATIONS.json); mcp-server-rekindle.full.log (host log bearing local
  paths).
- gate3-o5: invalidated-run-1/ tree (model replies quoted fragments of the
  maintainer's user-level MCP environment; the invalidation is documented in
  RESULTS.md and the fixed instrument is this tree's gate3-o5.sh).
- gate4: host session-storage JSONL transcripts for sessions ec1884c0,
  5679ee3f, 3647e692 (they carry host-machine metadata; every claim made
  from them in RESULTS.md cites the specific entries, and the receipts +
  fixture files published here are the synthetic layer).
- adversarial: p1-stderr.log, p3-stderr.log, p5-stderr.log (empty or
  path-bearing; byte counts recorded in probes output).

All originals are retained unmodified and can be produced to the reviewer
privately on request, per the 2026-08-05 evidence-handling precedent.
