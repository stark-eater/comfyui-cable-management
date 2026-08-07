# Passthrough x reroute/ribbon interaction sweep

QA round (2026-08-06): the three drag bugs all lived in the seam between per-LINK
ledger anchoring, per-SEGMENT reroute rendering, and per-END gestures. This sweep
enumerates that seam. Version-independent (1.47.10 drag machinery is byte-identical
to 1.48.6 -- verified by tag diff).

## Invariants every probe asserts (Barney's prime failure signatures)

1. ANCHOR: a passthrough-anchored link draws from its pin (`__cablemanagementCapture` /
   `__cablemanagementDraw` start point) after EVERY mutation step -- never from the true
   origin -- and routes never start within 30px of the hidden/true origin slot.
2. NO ORPHAN PINS: after any disconnect/delete, no comb lane survives whose
   teeth carry zero links and zero floating links (gate pins with no wire), and
   no reroute lingers with empty linkIds + empty floatingLinkIds.

Anchor flavours: WIDGET (owned primitive; host fallback in ledger) / INPUT
(provenance record only -- fragile, self-invalidates on link-id change) / GATE
(subgraph boundary, extra-keyed records).

## Cells

| id | cell | covered by | status |
|----|------|-----------|--------|
| A | plain reroute inserted on a passthrough link (core Add Reroute), then: move dot, undo, reload | — | todo |
| B | INPUT-flavour combed link, reposition input end (drop back + drop elsewhere). Suspect: reconnect mints a NEW link id -> provenance self-invalidates -> permanent reversion (movecomb covers WIDGET flavour only, which has the host fallback) | movecomb (widget only) | todo |
| C | delete a combed link entirely (input end off into empty + escape / core link delete): lane pins must not survive wireless | — | todo |
| D | disconnect combed link -> floating lane -> delete the float: teeth + lane + floatfrom cleanup | — | todo |
| E | undo/redo across comb create / enroll / decompose with passthrough links riding: anchors + records after each step (checkpoint the change tracker first -- shared-server trap) | — | todo |
| F | save/serialize + configure() reload with combed INPUT-flavour links (passcomb covers widget flavour) | passcomb (widget) | todo |
| G | mixed chain: user reroute AND comb teeth on the same passthrough link (reroute before in-gate / after out-gate) | — | todo |
| H | in-tooth detach of a passthrough lane: freed dot keeps drawing from pin; no orphan out-tooth | pathing-combgest (plain links) | todo |
| I | decompose flavours (delete in-gate / delete out-gate / delete both / api.decompose / auto-decompose below 2 lanes) x both anchor flavours, ops after: node move, new link, reroute drag, undo, reload | probe-decomp, probe-decomp2 (partial: exit-gate delete, no undo/reload ops) | todo |
| J | combed passthrough INSIDE a subgraph: enter/exit remount anchor stability | combsub (no passthroughs) | todo |
| K | copy/paste and delete of nodes whose links ride lanes (paste fixups vs comb records; comb records reference dead reroute ids after paste?) | copypaste (no combs) | todo |
| L | floating lane whose float came from a PIN drag (floatfrom record), completed via out-pin pull: is provenance recorded on the new target? INPUT flavour = suspect immediate reversion | passcomb (widget) | todo |
| M | delete the ORIGIN node / the HOST node / the CONSUMER node of a combed passthrough link: records, lanes, anchors of survivors | delrecon (no combs; skips without ShowText) | todo |

## Probe conventions

Standalone `sweep-<id>.mjs` per cell, harness idioms: COMFY_URL env, viewport
1900x1000, scene away from bottom-right minimap, grid-multiple coordinates, burn
6 redraw frames before reading routes, `window.__cablemanagementCapture = true` + fresh
`__cablemanagementDraw` per read, checkpoint change tracker before undo, NEVER write
server settings. Each probe prints ok/FAIL lines and exits non-zero on FAIL.
Red probes are BUG EVIDENCE: leave them red, report the mechanism.

## Results (2026-08-06, ultracode fan-out + serial fixes)

All 13 cells GREEN after two fixes. Probes live as `sweep-a.mjs` .. `sweep-m.mjs`.

| id | outcome |
|----|---------|
| A,F,G,H,I,J,K | green as probed |
| B | green -- suspect defused: drop-back reuses the link id; a move to a new input re-records provenance via drag.js pending (pickup-time snapshot) |
| L | green -- suspect defused: floatfrom recorded at park (pending still live), completion re-records via link-created |
| C | RED -> fixed. See phantom bug below |
| D | RED -> fixed (same root). Disconnect now parks a genuine dangling lane; deleting the float leaves wireless teeth that combPass reaps |
| M | RED -> fixed (same root). Deleting origin/host/consumer now leaves lanes riding genuine core floats (legal) or decomposes |
| E | FLAKY -> fixed. Serialize idempotency, see below |

### Bug 1: phantom floatingLinkIds (CORE, latent in 1.47.10 AND 1.48.6)

`LGraph.createReroute(pos, before)` seeds the new reroute's floatingLinkIds with
`[before.id]` when `before` is a REAL LLink, and nothing prunes the unresolvable
id (validateLinks only runs on configure/paste). Effects: core's reroute GC
counts the phantom (totalLinks) so fully-deleted links leave wireless teeth
forever; core's disconnect-to-float is gated on floatingLinkIds.size===0 so the
phantom VETOES the dangling-lane limbo. Extension fix: combs.js `mint()` scrubs
non-resolving floating ids off every tooth at creation, and combPass scrubs +
requires a live wire per lane, reaping wireless teeth (auto-decompose follows).
NOTE: stock reroutes created from a link (core's own Add Reroute passes the
LLink too) carry the same phantom -- upstream PR candidate.

### Bug 2: serialize/configure non-idempotency wipes the redo queue

configure() rebuilds a Primitive's widgets (value + control_after_generate +
combo filter) and recomputes node `order`; our materialise seeded one widget and
the primitive is always created after its consumers, so live state never equals
its own reload. ChangeTracker.graphEqual compares full node objects; after every
undo/redo restore, captureCanvasState (fired by mouseup/keyup/etc.) saw the
drift as a user edit and CLEARED redo. Fix: primitive.js ensureStableSerial
(one-time core recreateWidget() once a real consumer exists; gate-first prims
excluded -- their drift remains a known corner) + graph.updateExecutionOrder()
in the sync walk while machinery is present. Verified serialize->configure->
serialize byte-identical; sweep-e green twice.

## Known flake: cell E on CU-5 (frontend 1.47.10) -- 2026-08-07

Intermittent, CU-5 only, never observed on vanilla/1.48.6. Two faces, ~2 in 13
standalone runs under load: (1) pageerror `Cannot access 'finish' before
initialization` (x2, asserts still pass; also struck subpass x3 in yesterday's
parallel battery; never yet caught with a stack -- sweep-e now captures full
stacks permanently); (2) redo restores without the comb record -- lanes gone,
links ride true origins (x1, asserts fail; degradation to plain reroutes, no
data corruption). Suspected ChangeTracker/serialize timing race under load on
the older frontend. Non-blocking for publish: the shipping target (current
frontend) is 100% clean across the battery and repeated standalone runs.

RESOLVED 2026-08-07 (later same day): the TDZ face was a REAL bug -- import cycle
via isEnabled in index.js let registerExtension run before drag.js finished
evaluating; a settings store hydrated early enough fired start() into the
half-evaluated module. Fixed structurally: the flag moved to enabled.js (leaf),
nothing imports index.js anymore. The redo face is CORE's: ChangeTracker re-mints
the graph id at an arbitrary moment and wipes the redo queue when the mint lands
inside the undo/redo window (stock reroutes reproduce it). sweep-e now
fingerprints that exact wipe (queue emptied + .id drift) and skips the two redo
asserts with cause; a redo core actually performed still hard-fails if comb-less.
Also affects vanilla; 14/14 clean after, incl. one correctly-fingerprinted skip.
