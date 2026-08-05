# Compatibility Spike Evidence (runs of 2026-08-03; sanitized republication of 2026-08-05)

Artifacts referenced by `docs/compatibility-spike-evidence-manifest.json`, published so the ledger review can verify content, not only hashes.

**Republication note.** The first publication of this tree included eight textual artifacts copied from a live personal environment (full desktop-client configurations, logs containing a complete environment PATH dump, scripts and logs with absolute home paths). The reviewer caught it; the maintainer ruled containment. That commit was removed from branch history and this tree is the sanitized republication. The standard now enforced: **no public artifact is copied from a live personal environment** — public evidence is born in a clean fixture or deliberately constructed from an allowlist, and `scripts/compatibility-spike/evidence-gate.sh` (below) is the fail-closed check that makes the standard structural rather than prose.

## Layout and verification

Paths under this directory mirror the manifest's artifact paths exactly. To re-verify any published original, compare `sha256(file)` against the manifest entry for the same relative path. All 24 originals published here were hash-verified against the manifest at publish time, zero mismatches. Files named `*.redacted.*` are derivatives, not manifest artifacts — verify them through their provenance records instead (below).

Two manifest artifacts already live elsewhere in this repository and are not duplicated here:

| Manifest path | Repository location |
|---|---|
| `rekindle-dist-index.js` | `dist/index.js` |
| `session-start-probe.mjs` | `scripts/compatibility-spike/session-start-probe.mjs` |

## Withheld artifacts (14)

The following manifest entries are not published. Their SHA-256 hashes remain bound in the manifest, and the originals are retained by the maintainer under access control, producible privately to a reviewer on request.

**Configuration and environment (1 + 3):**
- `desktop/CD-BACKUP/claude_desktop_config.pre.json`: the maintainer's personal desktop-client configuration. Its evidentiary role is the pre/post restore hash pair proving byte-identical restoration, and both hashes are already on the record.
- `desktop/CD-M-01/config-used-cwd-wrapper.json`, `desktop/CD-H-01/attempt1/config-used.json`, `desktop/CD-H-01/attempt2/config-used.json`: as-run configurations that embedded the maintainer's full preference tree alongside the keys under test. Minimal projections carrying only the measurement-relevant keys (`mcpServers`, and `hooks` where it was the channel under test) are published as `*.redacted.json` derivatives.

**Logs and scripts (5):**
- `desktop/CD-M-01/mcp-log-as-shipped-attach-failure.log`, `desktop/CD-M-02/mcp-log-reconnect.log`: contained a complete environment PATH dump (personal toolchain inventory). Published derivatives preserve every error line, stack trace, and timestamp; the PATH dump is collapsed to a counted redaction marker.
- `desktop/CD-capture-log.txt`, `run-cases.sh`, `desktop/desktop-cases.sh`: contained absolute home/workspace paths. Published derivatives generalize paths to `<HOME>`/`<WORKSPACE>`; hashes, timestamps, and logic are unmodified.

**Screenshots (5):**
- `desktop/CD-H-01/attempt1/chat-session-screenshot.png`, `desktop/CD-H-01/attempt2/chat-session-screenshot.png`, `desktop/CD-M-01/attach-failure-toast-screenshot.png`, `desktop/CD-M-01/attempt1-reply-screenshot.png`, `desktop/CD-M-01/attempt2-reply-screenshot.png`: full-desktop captures including the maintainer's personal environment. Cropped derivatives preserving the complete evidentiary content are published under `derived/`.

## Derivative provenance

Two provenance files chain every derivative to its withheld original by dual SHA-256:

- `derived/DERIVATIONS.json` — screenshot crops: original manifest path, original hash (matching the manifest), derivative hash, exact crop box.
- `CONFIG-DERIVATIONS.json` — textual redactions: original manifest path, original hash (matching the manifest), derivative hash, and a description of the exact transformation applied.

Derivatives are reviewer conveniences whose provenance chains to the withheld originals through those hashes; they are not themselves manifest artifacts.

## Scope of the configuration-preservation claim

Earlier language implied the desktop runner's config mutations preserve all user preferences generically. The accurate, narrower claim: during a run, all keys outside `mcpServers` are carried unmodified, while the `mcpServers` object is deliberately **replaced** (not merged) for test isolation; afterward the entire original file is restored and verified byte-identical by hash pair (`CD-capture-log`). A live configuration whose `mcpServers` is non-empty would have its server entries absent for the duration of the run. Future runners must either merge or state replacement explicitly in their receipts.

## Lessons enforced in the harness

Both leak classes this evidence set produced are now unrepresentable by construction, not discouraged by prose:

1. **Screenshots** — `scripts/compatibility-spike/capture-window.sh` resolves the target app's window ID and captures only that window (`screencapture -l`), fail-closed on ambiguous or missing windows and on empty output. The desktop, menu bar, and other windows are structurally outside the frame. Verified live 2026-08-05.
2. **Textual artifacts** — `scripts/compatibility-spike/evidence-gate.sh` scans any evidence tree for personal-environment content before publication: generic patterns (real home paths on any OS, device-name shapes) plus a maintainer-private denylist held outside the repository. It fails closed when the denylist is absent. This tree passes the gate; the original tree fails it (that negative test is on the record in the correction post).
