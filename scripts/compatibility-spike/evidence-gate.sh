#!/bin/bash
# evidence-gate.sh — fail-closed personal-context scanner for evidence trees.
#
# Rule enforced: no public artifact is copied from a live personal environment.
# Public evidence is born in a clean fixture or deliberately constructed from an
# allowlist; this gate is the check that makes that rule structural instead of
# prose. Run it against any directory BEFORE staging its contents for publication:
#
#   scripts/compatibility-spike/evidence-gate.sh <dir>
#
# Detection layers:
#   1. Generic patterns (below): real home-directory paths on any OS and
#      device-name shapes. Sanitized artifacts must use <HOME>/<WORKSPACE>
#      placeholders, which these patterns deliberately do not match.
#   2. A private denylist of maintainer-specific identifiers (names, account
#      IDs, hostnames, project names). The denylist lives OUTSIDE the public
#      repository — publishing a list of personal identifiers would itself be
#      a leak — at $EVIDENCE_DENYLIST (default below). The gate FAILS CLOSED
#      if the denylist is missing or empty: generic patterns alone are not
#      sufficient coverage, so absence of the second layer is an error, not
#      a pass.
#
# Exit codes: 0 = clean; 1 = findings (listed on stdout); 2 = gate misconfigured.
set -u

DIR="${1:-}"
DENYLIST="${EVIDENCE_DENYLIST:-$HOME/Desktop/Tessera/rekindle-spike/private/evidence-denylist.txt}"

if [ -z "$DIR" ] || [ ! -d "$DIR" ]; then
  echo "GATE MISCONFIGURED: usage: evidence-gate.sh <directory>" >&2
  exit 2
fi
if [ ! -s "$DENYLIST" ]; then
  echo "GATE MISCONFIGURED (fail-closed): private denylist missing or empty: $DENYLIST" >&2
  echo "Generic patterns alone are insufficient; refusing to pass anything." >&2
  exit 2
fi

FAIL=0

# Layer 1: generic personal-environment patterns (placeholders <HOME>/<WORKSPACE> do not match)
GENERIC='(/Users/[A-Za-z]|/home/[a-z]|C:\\+Users\\+|[A-Za-z0-9]+s-(laptop|macbook|mbp|imac|desktop))'
if grep -rInE "$GENERIC" "$DIR"; then
  FAIL=1
fi

# Layer 2: maintainer-specific denylist (case-insensitive extended regex, one pattern per line)
while IFS= read -r pattern; do
  [ -z "$pattern" ] && continue
  case "$pattern" in \#*) continue ;; esac
  if grep -rIinE -- "$pattern" "$DIR"; then
    FAIL=1
  fi
done < "$DENYLIST"

if [ "$FAIL" -ne 0 ]; then
  echo "EVIDENCE GATE: FAIL — personal context found (lines above). Nothing in $DIR is publishable." >&2
  exit 1
fi
echo "EVIDENCE GATE: PASS — no generic or denylisted personal context in $DIR"
exit 0
