#!/bin/bash
# Legacy-mode battery: old nodes (Comfy.VueNodes.Enabled=false on the target
# instance -- this script does NOT flip it, point it at an instance already in
# legacy mode). Scope: PCB routing + ribbons/combs + reroutes on graphs an
# old-UI user can create. Node-modification suites (pass-throughs, widget
# pins, drawers) are excluded by design -- that machinery is Vue-only.
# Excluded with them: all sweep-* (pass-through-anchored cells), pathing-ledger
# (widget pass-through routing), gatefloat (needs a boundary-fed pass-through
# pin). Undo/redo coverage in legacy is therefore only spectral's smoke pass --
# known gap. pathing-stubrank excluded pending a spec ruling: its scene premise
# (CLIPTextEncode taller than KSampler's negative slot) is Vue-geometry; legacy
# node heights make slot 2 a trivial-straight entry and the hardcoded rank
# ladder does not transfer. pathing-adjacent / pathing-combrank need the
# author's node pack -- expected env-FAIL on a stock install, same as the main
# battery.
cd "$(dirname "$0")"
OUT="${RESULTS:-battery-results-legacy.txt}"
LOGDIR="${LOGDIR:-/tmp}"
mkdir -p "$LOGDIR"
SUITES="pathing-milestone pathing-lanes pathing-fixes pathing-furniture pathing-adjacent pathing-overlapgate pathing-nudge-unit pathing-reroutedir pathing-gapbias pathing-combs pathing-combgest pathing-combfloat pathing-combsel pathing-combflip pathing-combrank pathing-combcaret pathing-combtheme combsub spectral"
> "$OUT"
for s in $SUITES; do
  [ -f "$s.mjs" ] || { echo "$s MISSING" >> "$OUT"; continue; }
  if node "$s.mjs" > "$LOGDIR/battery-legacy-$s.log" 2>&1; then
    echo "$s PASS" >> "$OUT"
  else
    echo "$s FAIL" >> "$OUT"
  fi
done
echo DONE >> "$OUT"
