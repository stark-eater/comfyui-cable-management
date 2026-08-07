// Passthrough pins as DROP TARGETS -- the receiving half of the junction model.
//
// Only the CONSUMER direction needs us: an input-drag (seeking an output)
// dropped on a pin connects the consumer to the pin's VALUE -- the upstream
// origin for a connected input, the owned primitive for a widget literal
// (materialised on demand, reaped if the connect refuses). Source drags dropped
// on a pin already land through core's node-body drop (first matching input).
//
// Core cannot see the pins at all: they are not slots, and during a drag they
// are pointer-events:none besides -- so the drop pipeline resolves them from
// the pin DOM by proximity, in graph units, at the same seams the reroute belt
// uses (dropOnNothing and dropOnNode instance wraps in pathing.js).
import { activeGraph, nodeFromId, originOf } from "./graph.js";
import { materialise, ownerOf, reapIfUnused } from "./primitive.js";
import { recordProvenance, recordGateProvenance } from "./reanchor.js";
import { stitchGates, isStitch } from "./stitch.js";
import { invalidate, anchorOf } from "./ledger.js";

function typeMatch(a, b) {
  return a == null || b == null || a === "*" || b === "*" || String(a) === String(b);
}

/** Nearest pin within 12 graph units, filtered to the dragged type. */
function pinNear(graph, x, y, type) {
  let best = null;
  let bd = 12;
  for (const el of document.querySelectorAll(".cablemanagement-pin")) {
    const node = nodeFromId(graph, el.dataset.cablemanagementNode);
    if (!node) continue;
    if (!typeMatch(el.dataset.cablemanagementType, type)) continue;
    const a = anchorOf(el, node);
    if (!a) continue;
    const d = Math.hypot(a[0] - x, a[1] - y);
    if (d < bd) {
      bd = d;
      best = { el, node, anchor: a };
    }
  }
  return best;
}

export function handlePinDrop(app, lc, event) {
  const graph = activeGraph(app);
  if (!graph || lc.state?.connectingTo !== "output") return false;
  // One connect per gesture: a pin straddles the node edge, so a drop on its
  // outer half can reach BOTH seams (the pointerup below, then dropOnNothing).
  if (lc.__cablemanagementPinDone) return false;

  const best = pinNear(graph, event.canvasX, event.canvasY, lc.renderLinks[0]?.fromSlot?.type);
  if (!best) return false;

  const host = best.node;
  const index = Number(best.el.dataset.cablemanagementIndex);
  const kind = best.el.dataset.cablemanagementKind;

  let created = null;
  let tryConnect;
  if (kind === "link") {
    const origin = originOf(graph, host, index);
    if (!origin) return false;
    if (origin.node === graph.inputNode) {
      // Boundary origin: the pin's value IS the subgraph input, so feed the
      // consumer straight from the gate slot -- an ordinary gate->node link.
      // (Only gate-to-GATE is unsupported, and a consumer drag never IS a gate.)
      const gateSlot = graph.inputNode.slots?.[origin.slot];
      if (!gateSlot) return false;
      tryConnect = (rl) => {
        // A drag FROM the output gate landing here is gate-to-gate: core's
        // connectToSubgraphInput EXISTS but throws 'Not implemented' -- bridge
        // with a branded reroute instead (see stitch.js).
        if (rl.isIoNodeLink) {
          return !!stitchGates(graph, gateSlot, rl.fromSlot, event.canvasX, event.canvasY, [String(host.id), index]);
        }
        if (typeof rl.connectToSubgraphInput !== "function") return false;
        if (typeof rl.canConnectToSubgraphInput === "function" && !rl.canConnectToSubgraphInput(gateSlot))
          return false;
        rl.connectToSubgraphInput(gateSlot, lc.events);
        return true;
      };
    } else {
      const srcNode = origin.node;
      const srcSlot = origin.node.outputs?.[origin.slot];
      if (!srcNode || !srcSlot) return false;
      tryConnect = (rl) => {
        if (!rl.canConnectToOutput?.(srcNode, srcSlot)) return false;
        rl.connectToOutput(srcNode, srcSlot, lc.events);
        return true;
      };
    }
  } else {
    const existing = ownerOf(graph, host, index);
    const prim = existing ?? materialise(app, host, index);
    if (!prim) return false;
    if (!existing) created = prim;
    const srcSlot = prim.outputs?.[0];
    if (!srcSlot) return false;
    tryConnect = (rl) => {
      if (!rl.canConnectToOutput?.(prim, srcSlot)) return false;
      rl.connectToOutput(prim, srcSlot, lc.events);
      return true;
    };
  }

  const before = graph.state?.lastLinkId ?? 0;
  let did = false;
  for (const rl of lc.renderLinks) {
    if (rl.toType !== "output") continue;
    // The pin feeding its own slot would be the machinery link cablemanagement never creates.
    if (rl.node === host && rl.fromSlot === host.inputs?.[index]) continue;
    if (tryConnect(rl)) did = true;
  }
  if (!did) {
    if (created) reapIfUnused(graph, created);
    return false;
  }

  // Provenance for every link the drop just made: it was pulled ONTO the pin,
  // so it draws from the pin -- same record a drag FROM the pin would leave.
  // A gate target has no properties bag; its record lives in graph.extra.
  const after = graph.state?.lastLinkId ?? 0;
  for (let id = before + 1; id <= after; id++) {
    const link = graph.getLink ? graph.getLink(id) : graph._links?.get?.(id);
    if (!link) continue;
    // Stitch segments draw honestly -- the reroute at the drop point already
    // tells the story, and pin provenance on machinery would relocate it.
    if (isStitch(nodeFromId(graph, link.origin_id))) continue;
    if (link.targetIsIoNode ?? String(link.target_id) === "-20") {
      recordGateProvenance(graph, link, host, index);
      continue;
    }
    const target = nodeFromId(graph, link.target_id);
    if (isStitch(target)) continue;
    if (target?.properties) recordProvenance(target, link.target_slot, host, index, link.id);
  }
  invalidate();
  graph.setDirtyCanvas(true, true);
  lc.__cablemanagementPinDone = true;
  // Consume the drag: the Vue finish still runs AFTER this seam and would hand
  // the same render links to its snapped candidate -- the node-hover implied
  // connection to the first unoccupied matching output -- which would connect
  // again and REPLACE the pin link (an input holds one link; measured: the
  // implied connection always won on hosts with a matching output). An empty
  // renderLinks makes every later stage a no-op; reset clears it anyway.
  lc.renderLinks.length = 0;
  return true;
}

/**
 * The Vue seam. Vue slot drags never consult the link connector for drops on
 * node DOM: connectByPriority tries slot/reroute candidates, then dropOnCanvas
 * ONLY when the drop target is the canvas element -- a drop on a pin over a
 * node's DOM simply dies. This window-CAPTURE pointerup runs before the Vue
 * handler (per-gesture listeners register later than us). Legacy drags never
 * reach it (core's boot-time window-capture up handler stops propagation for
 * gestures it owns) -- those come through the dropOnNothing / dropOnNode wraps
 * instead; the __cablemanagementPinDone latch keeps the seams from double-connecting.
 */
export function installPinDrops(app) {
  window.addEventListener(
    "pointerup",
    (e) => {
      if (e.button !== 0) return;
      const lc = app.canvas?.linkConnector;
      if (!lc?.isConnecting) return;
      try {
        const c = app.canvas;
        const p = c.convertEventToCanvasOffset?.(e);
        if (!p) return;
        handlePinDrop(app, lc, { canvasX: p[0], canvasY: p[1] });
        // The owning pipeline still runs its own cleanup and resets the
        // connector; with the consumer already connected it finds no candidate.
      } catch (err) {
        console.warn("cablemanagement: pin drop failed", err);
      }
    },
    true
  );

  // Preview magnet. While the cursor sits on a type-matching pin, the Vue drag
  // loop still computes its node-hover implied candidate and writes its slot
  // position into lc.state.snapLinksPos every RAF -- the wire visibly yanks to
  // an output the drop will not use. state is ONE object mutated in place
  // (reset only assigns undefined), so an accessor on snapLinksPos redirects
  // EVERY write -- no race with their RAF. Legacy drags never write the field;
  // the pointermove below feeds them, and clears only its own stale write.
  let lastPt = null;
  const magnet = (lc) => {
    if (!lastPt || lc.state.connectingTo !== "output") return null;
    const graph = activeGraph(app);
    if (!graph) return null;
    return pinNear(graph, lastPt[0], lastPt[1], lc.renderLinks[0]?.fromSlot?.type);
  };
  const armSnap = (lc) => {
    const st = lc?.state;
    if (!st || Object.getOwnPropertyDescriptor(st, "snapLinksPos")?.get) return;
    let val = st.snapLinksPos;
    Object.defineProperty(st, "snapLinksPos", {
      configurable: true,
      get: () => val,
      set: (v) => {
        const pin = Array.isArray(v) && lc.isConnecting ? magnet(lc) : null;
        if (pin) {
          val = [pin.anchor[0], pin.anchor[1]];
          lc.__cablemanagementMagnetPos = val;
        } else {
          val = v;
        }
      },
    });
  };
  window.addEventListener(
    "pointermove",
    (e) => {
      const lc = app.canvas?.linkConnector;
      if (!lc?.isConnecting) {
        lastPt = null;
        return;
      }
      try {
        armSnap(lc);
        const p = app.canvas.convertEventToCanvasOffset?.(e);
        lastPt = p ? [p[0], p[1]] : null;
        const pin = magnet(lc);
        if (pin) {
          lc.state.snapLinksPos = [pin.anchor[0], pin.anchor[1]];
        } else if (lc.state.snapLinksPos === lc.__cablemanagementMagnetPos && lc.__cablemanagementMagnetPos) {
          // Only our own stale write is cleared -- a Vue candidate write is
          // theirs to manage (they rewrite next frame anyway).
          lc.state.snapLinksPos = undefined;
          lc.__cablemanagementMagnetPos = null;
        }
      } catch (err) {
        console.warn("cablemanagement: pin magnet failed", err);
      }
    },
    true
  );
}
