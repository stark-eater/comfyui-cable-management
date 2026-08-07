// Deriving ledger entries from recorded provenance.
//
// Built from our own markers, never from a scan of every link and never from `renderedPaths`
// -- the latter is cleared before drawConnections' early-outs, so a ledger derived from it
// goes blank in Hidden-links mode and for the frames right after a workflow load or an undo,
// which is exactly when the machinery would show.
//
// PROVENANCE, not inference. A link created by dragging a pass-through pin is
// indistinguishable, in the graph, from one wired by hand -- that is the point of resolving
// to a real origin. So we cannot infer which links to re-anchor; guessing would relocate
// wires the user drew deliberately. Instead the drop records where it came from, on the
// TARGET node, keyed by the target input index (an input holds at most one link).
//
// It lives in `properties` for the same reasons `cablemanagement.owned` does: litegraph's sanctioned
// serialised bag, survives save/load so the picture is stable across reloads, and without the
// extension it is one unread property on a node.

import { SUPPRESS, anchorOf } from "./ledger.js";
import { isOwned } from "./primitive.js";
import { isStitch } from "./stitch.js";
import { nodeById } from "./graph.js";

const FROM = "cablemanagement.from";
const FLOATFROM = "cablemanagement_floatfrom"; // graph.extra: rerouteId -> [hostId, hostIndex]
const GATEFROM = "cablemanagement_gatefrom"; // graph.extra: linkId -> [hostId, hostIndex], target is the output gate

/**
 * Record that `target.inputs[targetIndex]` was created by dragging the pin on (host, hostIndex).
 *
 * The LINK ID is part of the record. Provenance describes one specific link; if the user
 * later hand-wires something else into the same input, the slot index alone would still
 * match and the ledger would relocate a wire the user drew deliberately. The id makes the
 * record self-invalidating: link gone or replaced, record ignored and pruned.
 */
export function recordProvenance(target, targetIndex, host, hostIndex, linkId) {
  if (!target || !host) return;
  const map = { ...(target.properties?.[FROM] ?? {}) };
  map[String(targetIndex)] = [String(host.id), hostIndex, linkId];
  target.properties[FROM] = map;
}

/**
 * Gate-target flavour of the record above. A link landing on the subgraph OUTPUT GATE has
 * no node to carry properties -- the IO nodes are canvas-drawn, property-less objects (and
 * writing to one crashes) -- so the record lives in graph.extra keyed by LINK ID. Same
 * self-invalidation: link gone, entry pruned. graph.extra serialises with the subgraph.
 */
export function recordGateProvenance(graph, link, host, hostIndex) {
  if (!graph || !link || !host) return;
  const extra = (graph.extra ??= {});
  const gf = (extra[GATEFROM] ??= {});
  gf[String(link.id)] = [String(host.id), hostIndex];
}

/** A link whose target is the output gate; tolerates plain objects without the getter. */
function targetsGate(link) {
  return link?.targetIsIoNode ?? String(link?.target_id) === "-20";
}

/**
 * The valid provenance entry for an input, or null (none recorded, or stale).
 * With `graph`, an entry whose host no longer exists is stale too -- the link id alone
 * still matches after the HOST dies (deleting a node mid-chain removes the host but not
 * the link), and a dead-host entry blocks the ledger's own fallbacks.
 */
export function provenanceOf(node, index, graph) {
  const entry = node?.properties?.[FROM]?.[String(index)];
  const slot = node?.inputs?.[index];
  if (!entry || !slot || slot.link == null) return null;
  if (entry[2] != null && entry[2] !== slot.link) return null;
  if (graph && !nodeById(graph, entry[0])) return null;
  return entry;
}

/** Forget provenance for an input (its link was removed or replaced by hand). */
export function forgetProvenance(target, targetIndex) {
  const map = target?.properties?.[FROM];
  if (!map || !(String(targetIndex) in map)) return;
  const next = { ...map };
  delete next[String(targetIndex)];
  if (Object.keys(next).length) target.properties[FROM] = next;
  else delete target.properties[FROM];
}

function pinEl(nodeId, index) {
  return document.querySelector(
    `.cablemanagement-pin[data-cablemanagement-node="${CSS.escape(String(nodeId))}"][data-cablemanagement-index="${CSS.escape(String(index))}"]`
  );
}

/**
 * A resolver that survives re-renders.
 *
 * Anchors must be computed per frame (a cached point freezes when the origin node is
 * dragged), and the element itself must be re-fetched when it detaches -- Vue replaces a
 * node's DOM on many updates, and a detached element reports offsetLeft 0, which would slam
 * the anchor to the node's top-left corner.
 */
function anchorResolver(graph, nodeId, index) {
  let el = pinEl(nodeId, index);
  return () => {
    if (!el?.isConnected) el = pinEl(nodeId, index);
    const node = nodeById(graph, nodeId);
    return el && node ? anchorOf(el, node) : null;
  };
}

/**
 * @returns Map<linkId, SUPPRESS | { startPos }>
 */
export function build(graph) {
  const out = new Map();
  if (!graph) return out;

  const getLink = (id) =>
    graph.getLink ? graph.getLink(id) : graph._links?.get?.(id) ?? graph.links?.[id];

  // 1. Owned primitives -- pure machinery.
  //    The wire driving the host's own widget is suppressed; wires to daisy-chain consumers
  //    are re-anchored onto the widget pin the user dragged from.
  for (const node of graph.nodes ?? []) {
    if (!isOwned(node)) continue;
    const hostId = node.properties?.["cablemanagement.host"];
    const host = nodeById(graph, hostId);

    for (const linkId of node.outputs?.[0]?.links ?? []) {
      const link = getLink(linkId);
      if (!link) continue;
      // The primitive is never wired to its host, so there is no machinery link to
      // suppress -- only consumer links to re-anchor onto the pin they were pulled from.
      const target = nodeById(graph, link.target_id);
      const from = provenanceOf(target, link.target_slot, graph);
      const slot = host ? node.properties?.["cablemanagement.hostSlot"] : null;
      const anchor = from ?? (host && slot != null ? [String(host.id), slot] : null);
      if (anchor) out.set(link.id, { resolve: anchorResolver(graph, anchor[0], anchor[1]) });
    }
  }

  // 2. Input pass-throughs -- re-anchor onto the pin the drop came from.
  for (const node of graph.nodes ?? []) {
    const map = node.properties?.[FROM];
    if (!map) continue;
    for (const slotIdx of Object.keys(map)) {
      const from = provenanceOf(node, Number(slotIdx), graph);
      if (!from) continue; // stale record: draw honestly, prune() will drop or retarget it
      const link = getLink(node.inputs[Number(slotIdx)].link);
      if (!link || out.has(link.id)) continue; // owned-primitive pass above wins

      if (!nodeById(graph, from[0])) continue; // source node gone: draw it honestly
      out.set(link.id, { resolve: anchorResolver(graph, from[0], from[1]) });
    }
  }

  // 3. Floating links -- half-links parked by a pin drag (link-release menu's
  //    "Add Reroute", comb lanes). They render through the same choke point as
  //    real links but carry no target to hold provenance, so the pulled-from
  //    pin is recorded on the CHAIN'S REROUTE (drag.js writes graph.extra).
  //    Fallback: an owned-primitive origin is self-describing (host + slot).
  const ff = graph.extra?.[FLOATFROM] ?? {};
  for (const link of graph.floatingLinks?.values?.() ?? []) {
    let rec = null;
    let rid = link.parentId;
    let guard = 0;
    while (rid != null && guard++ < 100 && !rec) {
      rec = ff[String(rid)] ?? null;
      if (!rec) rid = graph.getReroute?.(rid)?.parentId;
    }
    if (!rec) {
      const origin = nodeById(graph, link.origin_id);
      if (isOwned(origin)) {
        rec = [String(origin.properties["cablemanagement.host"]), Number(origin.properties["cablemanagement.hostSlot"])];
      }
    }
    if (rec && nodeById(graph, rec[0])) {
      out.set(link.id, { resolve: anchorResolver(graph, rec[0], rec[1]) });
    }
  }

  // 4. Links INTO the output gate -- provenance from graph.extra (the gate cannot
  //    carry it; see recordGateProvenance).
  const gf = graph.extra?.[GATEFROM] ?? {};
  for (const lid of Object.keys(gf)) {
    const link = getLink(Number(lid));
    if (!link || !targetsGate(link) || out.has(link.id)) continue;
    const rec = gf[lid];
    if (!nodeById(graph, rec[0])) continue;
    out.set(link.id, { resolve: anchorResolver(graph, rec[0], rec[1]) });
  }

  // 5. Stitch reroutes created from a pin -- the primitive treatment: every
  //    outgoing segment re-anchors onto the pin, and the incoming gate segment
  //    is suppressed (the pin already tells that half of the story). A stitch
  //    with no record, or whose pin host died, draws honestly.
  for (const node of graph.nodes ?? []) {
    const rec = node.properties?.["cablemanagement.stitchFrom"];
    if (!rec || !isStitch(node)) continue;
    if (!nodeById(graph, rec[0])) continue;
    for (const linkId of node.outputs?.[0]?.links ?? []) {
      const link = getLink(linkId);
      if (!link || out.has(link.id)) continue;
      out.set(link.id, { resolve: anchorResolver(graph, rec[0], rec[1]) });
    }
    const inId = node.inputs?.[0]?.link;
    const inLink = inId != null ? getLink(inId) : null;
    if (inLink && !out.has(inLink.id)) out.set(inLink.id, SUPPRESS);
  }

  return out;
}

/**
 * Drop provenance whose link no longer exists or no longer matches, so a hand-rewired input
 * stops pretending it came from a pin.
 *
 * One case is retargeted instead of dropped: a record whose HOST died while its link
 * survives -- deleting a node in the middle of an apparent chain does exactly this. If the
 * surviving link's origin is hidden machinery, the machinery's own host pin is the only
 * honest place left to draw from; rewrite the record onto it. Any other origin is a
 * visible node, and honest drawing needs no record at all.
 */
export function prune(graph) {
  const getLink = (id) =>
    graph.getLink ? graph.getLink(id) : graph._links?.get?.(id) ?? graph.links?.[id];
  // Float records whose reroute or host died are dead weight.
  const ff = graph?.extra?.[FLOATFROM];
  if (ff) {
    for (const rid of Object.keys(ff)) {
      if (!graph.reroutes?.get?.(Number(rid)) || !nodeById(graph, ff[rid][0])) delete ff[rid];
    }
    if (!Object.keys(ff).length) delete graph.extra[FLOATFROM];
  }
  // Gate records whose link or host died are dead weight too.
  const gf = graph?.extra?.[GATEFROM];
  if (gf) {
    for (const lid of Object.keys(gf)) {
      const link = getLink(Number(lid));
      if (!link || !targetsGate(link) || !nodeById(graph, gf[lid][0])) delete gf[lid];
    }
    if (!Object.keys(gf).length) delete graph.extra[GATEFROM];
  }
  // Stitch pin records whose host died: the stitch stays (it still bridges),
  // only the pretty-draw record goes.
  for (const node of graph?.nodes ?? []) {
    const rec = node.properties?.["cablemanagement.stitchFrom"];
    if (rec && !nodeById(graph, rec[0])) delete node.properties["cablemanagement.stitchFrom"];
  }
  for (const node of graph?.nodes ?? []) {
    const map = node.properties?.[FROM];
    if (!map) continue;
    for (const slotIdx of Object.keys(map)) {
      const idx = Number(slotIdx);
      if (provenanceOf(node, idx, graph)) continue;
      const linkId = node.inputs?.[idx]?.link;
      const link = linkId != null ? getLink(linkId) : null;
      const origin = link ? nodeById(graph, link.origin_id) : null;
      const host = isOwned(origin) ? nodeById(graph, origin.properties["cablemanagement.host"]) : null;
      if (host) {
        recordProvenance(node, idx, host, Number(origin.properties["cablemanagement.hostSlot"]), link.id);
      } else {
        forgetProvenance(node, idx);
      }
    }
  }
}
