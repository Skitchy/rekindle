#!/usr/bin/env bash
# capture-window.sh <app-owner-name> <output.png> [--window-id <id>]
#
# Window-scoped screenshot for GUI measurement evidence. Captures ONLY the
# target app window via `screencapture -l`; the desktop, menu bar, and every
# other window are structurally outside the frame, so captures are born
# publishable and never need redaction.
#
# Fail-closed rules:
#   - exactly one on-screen window may match the owner name; zero or many
#     aborts with the candidate list (pass --window-id to disambiguate)
#   - output must exist and be non-empty or the script exits nonzero
#
# Origin: 2026-08-03 Desktop block used full-screen capture; all five
# screenshots required withholding + cropped derivatives because the
# maintainer's personal environment was in frame (see
# docs/compatibility-spike-evidence/EVIDENCE-README.md). This tool makes
# that failure class unrepresentable.

set -euo pipefail

OWNER="${1:?usage: capture-window.sh <app-owner-name> <output.png> [--window-id <id>]}"
OUT="${2:?usage: capture-window.sh <app-owner-name> <output.png> [--window-id <id>]}"
WIN_ID="${4:-}"

list_windows() {
  osascript -l JavaScript -e '
    ObjC.import("CoreGraphics");
    const owner = "'"$OWNER"'";
    const opts = $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements;
    const wins = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(opts, $.kCGNullWindowID)));
    const hits = wins.filter(w => w.kCGWindowOwnerName === owner && w.kCGWindowLayer === 0);
    hits.forEach(w => console.log([w.kCGWindowNumber, Math.round(w.kCGWindowBounds.Width) + "x" + Math.round(w.kCGWindowBounds.Height), JSON.stringify(w.kCGWindowName || "")].join("\t")));
  ' 2>&1
}

if [ -z "$WIN_ID" ]; then
  MATCHES="$(list_windows)"
  COUNT="$(printf '%s' "$MATCHES" | grep -c . || true)"
  if [ "$COUNT" -ne 1 ]; then
    echo "FAIL: expected exactly 1 on-screen window owned by '$OWNER', found $COUNT:" >&2
    printf '%s\n' "$MATCHES" >&2
    echo "Disambiguate with: capture-window.sh '$OWNER' '$OUT' --window-id <id>" >&2
    exit 1
  fi
  WIN_ID="$(printf '%s' "$MATCHES" | cut -f1)"
fi

screencapture -l"$WIN_ID" -x -o "$OUT"

if [ ! -s "$OUT" ]; then
  echo "FAIL: screencapture produced no output at $OUT (window $WIN_ID)" >&2
  exit 1
fi
DIMS="$(sips -g pixelWidth -g pixelHeight "$OUT" | awk '/pixel/ {print $2}' | paste -sd x -)"
echo "captured window $WIN_ID of '$OWNER' -> $OUT ($DIMS)"
