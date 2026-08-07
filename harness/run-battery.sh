#!/bin/bash
# Full battery. COMFY_URL selects the instance (default vanilla 8187); RESULTS
# overrides the output file so two instances can run side by side.
# passfloat/abortretry are EXCLUDED on purpose: they write the server-side
# Comfy.LinkRelease.Action setting -- never point them at an instance you care
# about. Suites that need the author's environment (real workflows, ShowText,
# his node pack) self-skip or fail fast on a stock install: stress pathing-stress
# pathing-braids subdrag subdiag regin3 subpass wplain delrecon copypaste
# pastechain pathing-adjacent pathing-combrank.
cd "$(dirname "$0")"
OUT="${RESULTS:-battery-results.txt}"
LOGDIR="${LOGDIR:-/tmp}"
mkdir -p "$LOGDIR"
SUITES="wvalue wdrop wplain regin regin2 chained searchbox searchclick reload combo movelink collapsednode delrecon copypaste pastechain passcomb pindrop subpass drawers drawers2 drawerqa impliedconn comborefresh hopheal combsub gatefloat toggle movecomb floatdrag dragsnap sweep-a sweep-b sweep-c sweep-d sweep-e sweep-f sweep-g sweep-h sweep-i sweep-j sweep-k sweep-l sweep-m pathing-milestone pathing-lanes pathing-fixes pathing-furniture pathing-ledger pathing-adjacent pathing-overlapgate pathing-nudge-unit pathing-stubrank pathing-reroutedir pathing-gapbias pathing-combs pathing-combgest pathing-combfloat pathing-combsel pathing-combflip pathing-combrank pathing-combcaret pathing-combtheme spectral"
> "$OUT"
for s in $SUITES; do
  [ -f "$s.mjs" ] || { echo "$s MISSING" >> "$OUT"; continue; }
  if node "$s.mjs" > "$LOGDIR/battery-$s.log" 2>&1; then
    echo "$s PASS" >> "$OUT"
  else
    echo "$s FAIL" >> "$OUT"
  fi
done
echo DONE >> "$OUT"
