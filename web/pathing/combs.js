// Combs -- grouped reroutes forming dense ribbon corridors (PATHING.md, comb round).
//
// A comb is a matched gate pair. Each gate is "half a node": normally spaced pins on
// one face, the composed ribbon leaving the other. Teeth are NATIVE reroutes (one
// in/out pair per lane) so persistence, undo, floating-link limbo, and extension-off
// degradation all ride core; the comb itself is only a grouping record in
// graph.extra plus geometry enforcement here. One gate is all "in", the other all
// "out": a member's chain always runs in-tooth before out-tooth, so the ribbon is
// uniform by construction while endpoint geometry stays free. Order is insertion
// order, top pin first; exit mirrors entry, so crossings the far endpoints demand
// happen outside the gates, never inside.
//
// PoC surface: programmatic API only (window.__cablemanagementCombs). Gestures come after.
import { offsetStrand, route } from './router.js'
import { activeGraph } from '../graph.js'

const KEY = 'cablemanagement_combs'
const GATE_W = 24 // gate body width; the pin->lane fan hides inside it
const PIN_PITCH = 20 // matches litegraph slot spacing ("normally spaced pins")
const LINE_W = 3 // core connections_width: the stroke each gap must clear
const GAP = 2 // design spec: the dark outline visibly separates the lanes
const PITCH = LINE_W + GAP // centreline spacing; a centre-to-centre 2 overlapped
const PAD = 12 // gate vertical padding around the pin column

// Read paths must not WRITE: stamping an empty array into every viewed graph's extra
// made merely opening+saving a workflow mutate the file.
const NO_RECORDS = []
function records(graph, create = false) {
  if (!graph.extra) {
    if (!create) return NO_RECORDS
    graph.extra = {}
  }
  if (!Array.isArray(graph.extra[KEY])) {
    if (!create) return NO_RECORDS
    graph.extra[KEY] = []
  }
  // graph.extra is untrusted workflow data: a malformed entry (non-object, missing
  // gates/lanes) would throw inside the render path and kill core's render loop for
  // the session. Repair in place -- garbage under OUR key gets dropped.
  const arr = graph.extra[KEY]
  for (let i = arr.length - 1; i >= 0; i--) {
    const c = arr[i]
    const ok = c && typeof c === 'object' && Array.isArray(c.lanes) &&
      c.in && Array.isArray(c.in.pos) && c.out && Array.isArray(c.out.pos)
    if (!ok) arr.splice(i, 1)
  }
  return arr
}

// Derived gate geometry. pos is the gate rect's top-left; pins on `pins` side, the
// ribbon face is the opposite edge. Ribbon lanes centre on the gate's middle.
function gateGeom(gate, n) {
  const h = PAD * 2 + Math.max(0, n - 1) * PIN_PITCH
  const [x, y] = gate.pos
  const pinX = gate.pins === 'left' ? x : x + GATE_W
  const ribbonX = gate.pins === 'left' ? x + GATE_W : x
  return {
    rect: [x, y, GATE_W, h],
    pinX,
    ribbonX,
    centerY: y + h / 2,
    pinY: (i) => y + PAD + i * PIN_PITCH,
    laneY: (i) => y + h / 2 + (i - (n - 1) / 2) * PITCH,
    pinDir: gate.pins, // direction a pin-side wire extends away from the gate
    ribbonDir: gate.pins === 'left' ? 'right' : 'left'
  }
}

// rerouteId -> {comb, lane, side} rebuilt by combPass; consulted per drawLink.
let toothIndex = new Map()
const tplCache = new Map() // combId -> {stamp, tpl}

// Gate bodies are routing obstacles. Without them the Hanan grid has NO lanes
// near a gate (lanes are obstacle edges), so a flipped face's wrap literally
// cannot exist -- A* fails and the fallback runs the ribbon straight through the
// body (measured: flip appeared to do nothing). Their inflated edges ARE the
// wrap lanes.
export function gateRects(graph) {
  const out = []
  for (const comb of records(graph)) {
    const n = comb.lanes.length
    out.push(gateGeom(comb.in, n).rect, gateGeom(comb.out, n).rect)
  }
  return out
}

export function toothOf(rid) {
  return toothIndex.get(rid) ?? null
}

// {comb, lane} when the two teeth are an in/out pair of one lane, else null.
export function combCrossing(sRid, eRid) {
  const a = toothIndex.get(sRid), b = toothIndex.get(eRid)
  if (!a || !b || a.comb !== b.comb || a.lane !== b.lane) return null
  if (a.side !== 'in' || b.side !== 'out') return null
  return { comb: a.comb, lane: a.lane }
}

// Once per frame, before core draws: validate records against graph truth (teeth
// deleted with the extension off, undo, etc.), auto-decompose below two lanes, snap
// teeth onto their pin slots, rebuild the index. A tooth the user is core-dragging
// is exempt from the snap -- the drop decides whether it detaches or snaps back.
export function combPass(graph, canvas) {
  if (!graph) return
  let held = null
  if (canvas?.pointer?.isDown && canvas.selectedItems) {
    for (const it of canvas.selectedItems) {
      if (it?.linkIds && it?.pos) (held ??= new Set()).add(it.id)
    }
  }
  const recs = records(graph)
  const idx = new Map()
  // A lane is live only while a real wire (or real float) rides its teeth. Tooth
  // EXISTENCE is not enough: the phantom floating id (see mint) defeats core's
  // own reroute GC, so a fully deleted link leaves both teeth behind and the gate
  // would render wireless pins forever (sweep cells C/M). Scrub phantoms off
  // surviving teeth each pass too -- absorbed user dots and workflows saved
  // before the fix carry them into the session.
  const scrub = (r) => {
    for (const id of [...(r.floatingLinkIds ?? [])]) {
      if (!graph.floatingLinks?.has?.(id)) r.floatingLinkIds.delete(id)
    }
  }
  const wired = (r) => {
    for (const id of r.linkIds ?? []) if (graph._links?.has?.(Number(id))) return true
    return (r.floatingLinkIds?.size ?? 0) > 0
  }
  for (let i = recs.length - 1; i >= 0; i--) {
    const comb = recs[i]
    comb.lanes = comb.lanes.filter((l) => {
      const tin = graph.reroutes?.get?.(l.in)
      const tout = graph.reroutes?.get?.(l.out)
      if (!tin || !tout) return false
      scrub(tin)
      scrub(tout)
      if (wired(tin) || wired(tout)) return true
      graph.removeReroute(l.in)
      graph.removeReroute(l.out)
      return false
    })
    if (comb.lanes.length < 2) {
      recs.splice(i, 1) // teeth stay behind as plain reroutes (spec)
      tplCache.delete(comb.id)
      continue
    }
    layout(graph, comb, held)
    comb.lanes.forEach((l, lane) => {
      idx.set(l.in, { comb, lane, side: 'in' })
      idx.set(l.out, { comb, lane, side: 'out' })
    })
  }
  toothIndex = idx

  // Marquee proxy: teeth ARE core-selectable, so a marquee over a gate catches
  // them. On idle frames (never mid-drag -- the in-tooth pull needs its selection
  // alive), convert selected teeth into GATE selection and purge them from core's
  // set; otherwise their stale-position overlays render and group-drags fight the
  // pin snap ("distorts the marquee", QA find).
  if (canvas && !canvas.pointer?.isDown && canvas.selectedItems?.size) {
    for (const it of [...canvas.selectedItems]) {
      if (!it?.linkIds || !it.pos) continue
      const t = idx.get(it.id)
      if (!t) continue
      canvas.selectedItems.delete(it)
      it.selected = false
      gateSel.set(selKey(t.comb, t.side), t.comb)
    }
  }
  // Prune entries whose RECORD is gone -- by object identity, so a reloaded
  // graph reusing a comb id never inherits the selection.
  if (gateSel.size) {
    const alive = new Set(recs)
    for (const [k, ref] of [...gateSel]) if (!alive.has(ref)) gateSel.delete(k)
  }
}

function layout(graph, comb, skip) {
  const n = comb.lanes.length
  for (const which of ['in', 'out']) {
    const g = gateGeom(comb[which], n)
    comb.lanes.forEach((l, i) => {
      if (skip?.has?.(l[which])) return
      const r = graph.reroutes.get(l[which])
      if (!r) return
      const dx = g.pinX - r.pos[0]
      const dy = g.pinY(i) - r.pos[1]
      // move(), never a pos write: it is the one path that syncs the frontend
      // layout store, which marquee, right-click, and Vue drop hit-testing all
      // read (a raw pos write left teeth registered at their creation position).
      if (dx || dy) r.move(dx, dy)
    })
  }
}

// Ribbon polyline for one lane: pin, fan inside the gate body, offset template
// between the ribbon faces, mirrored fan, pin. The template is ONE routed link
// (gate centre to gate centre, clearance inflated by the ribbon's half-width);
// lanes ride it via the strand offset machinery, so bends nest like a bundle.
export function crossingPts(graph, comb, lane, obstacles, clearance, version) {
  const n = comb.lanes.length
  const gi = gateGeom(comb.in, n)
  const go = gateGeom(comb.out, n)
  const off = (lane - (n - 1) / 2) * PITCH
  const a = [gi.ribbonX, gi.laneY(lane)]
  const b = [go.ribbonX, go.laneY(lane)]
  const halfRibbon = Math.ceil(((n - 1) * PITCH) / 2)

  let mid = null
  // Direct seam mode: facing gates closer than the corridor the router needs
  // (both inflated bodies block every seam cell, so A* wraps a horseshoe OVER
  // the gates instead -- measured at spawn, where the gates touch). Lanes cross
  // the seam straight; when the gates are vertically offset, each lane's
  // vertical is staggered across the seam, ordered against the shift so the
  // parallel Zs nest without crossing each other.
  const dirIn = gi.ribbonDir === 'right' ? 1 : -1
  const dirOut = go.ribbonDir === 'right' ? 1 : -1
  const gap = (b[0] - a[0]) * dirIn
  // gap sign matters: ribbons facing AWAY from each other also pass the
  // opposed-dirs check but show a negative gap -- that shape must keep the
  // router wrap (flip round). Small negative slack covers facing gates dragged
  // into bodily overlap, where the wrap would flash back mid-drag.
  if (dirOut === -dirIn && gap >= -GATE_W && gap < 2 * (clearance + halfRibbon)) {
    if (Math.abs(a[1] - b[1]) < 0.1) {
      mid = [a, b]
    } else {
      const t = (b[1] > a[1] ? n - lane : lane + 1) / (n + 1)
      const vx = a[0] + dirIn * Math.max(gap, 0) * t
      mid = [a, [vx, a[1]], [vx, b[1]], b]
    }
  }

  if (!mid) {
    const stamp = `${comb.in.pos}|${comb.in.pins}|${comb.out.pos}|${comb.out.pins}|${n}|v${version}`
    let cached = tplCache.get(comb.id)
    if (!cached || cached.stamp !== stamp) {
      const tpl = route({
        start: [gi.ribbonX, gi.centerY],
        end: [go.ribbonX, go.centerY],
        startDir: gi.ribbonDir, // departs outward from the in-gate's ribbon face
        endDir: go.ribbonDir, // stub extends outward from the out-gate's ribbon face
        obstacles,
        clearance: clearance + halfRibbon,
        enforceStart: true, // gate faces are binding (flip round)
        enforceEnd: true
      })
      cached = { stamp, tpl }
      tplCache.set(comb.id, cached)
    }
    // Touching or near-degenerate gates simplify the template below 4 points --
    // unusable for strand offsets (and t[2] does not exist). Synth path covers it.
    if (cached.tpl && cached.tpl.length >= 4) {
      // Left-normal offset sign depends on the first mid run's travel direction.
      const t = cached.tpl
      const d1x = Math.sign(t[2][0] - t[1][0]) || Math.sign(b[0] - a[0]) || 1
      mid = offsetStrand(t, a, b, off * (d1x >= 0 ? -1 : 1))
    }
  }
  if (!mid) {
    // Trivial straight corridor (route() returned null) or degenerate template.
    mid =
      Math.abs(a[1] - b[1]) < 0.1
        ? [a, b]
        : [a, [(a[0] + b[0]) / 2, a[1]], [(a[0] + b[0]) / 2, b[1]], b]
  }

  const fan = (g, pin, lanePt) => {
    const fx = g.ribbonX + (g.ribbonDir === 'right' ? -4 : 4)
    return [pin, [fx, pin[1]], [fx, lanePt[1]]]
  }
  const pts = [
    ...fan(gi, [gi.pinX, gi.pinY(lane)], a),
    ...mid,
    ...fan(go, [go.pinX, go.pinY(lane)], b).reverse()
  ]
  return clean(pts)
}

function clean(pts) {
  const out = [pts[0]]
  for (let k = 1; k < pts.length; k++) {
    const a = out[out.length - 1], b = pts[k]
    if (Math.abs(a[0] - b[0]) < 0.1 && Math.abs(a[1] - b[1]) < 0.1) continue
    const c = out[out.length - 2]
    if (
      c &&
      ((Math.abs(c[0] - a[0]) < 0.1 && Math.abs(a[0] - b[0]) < 0.1) ||
        (Math.abs(c[1] - a[1]) < 0.1 && Math.abs(a[1] - b[1]) < 0.1))
    ) {
      out[out.length - 1] = b
      continue
    }
    out.push(b)
  }
  return out
}

// ---- gesture support ------------------------------------------------------------

// Gate selection -- gates act as nodes: click selects, marquee selects (via the
// TEETH, which core's marquee catches; combPass converts them to gate selection
// and purges them from core's set so nothing drags or outlines the pins
// themselves), selected gates draw on top and follow node-group drags.
// Keyed `${combId}|${which}` but VALUED by the record object: comb ids restart
// per graph, so a cleared/reloaded graph can mint a comb with a stale key's id
// and inherit a phantom selection (measured: a one-gate [del] dissolved both
// columns). Identity checks make the prune exact.
const gateSel = new Map() // `${combId}|${which}` -> comb record
const selKey = (comb, which) => `${comb.id}|${which}`

export function isGateSelected(comb, which) {
  return gateSel.get(selKey(comb, which)) === comb
}

// Selecting also moves the comb record to the END of the list -- record order is
// draw order, so "jump to top" persists the way node z-order does.
export function selectGate(graph, comb, which, add) {
  if (!add) gateSel.clear()
  gateSel.set(selKey(comb, which), comb)
  const recs = records(graph)
  const i = recs.indexOf(comb)
  if (i >= 0 && i !== recs.length - 1) {
    recs.splice(i, 1)
    recs.push(comb)
  }
}

export function clearGateSelection() {
  gateSel.clear()
}

export function selectedGates(graph) {
  const out = []
  for (const comb of records(graph)) {
    for (const which of ['in', 'out']) {
      if (isGateSelected(comb, which)) out.push({ comb, which })
    }
  }
  return out
}

export function gateSelectionKeys() {
  return [...gateSel.keys()]
}

// Hover state for the flip glyph; the gesture layer feeds it from pointermove.
let hover = null // {id, which}

export function setHover(hit, graph) {
  const next = hit ? { id: hit.comb.id, which: hit.which } : null
  if ((next?.id !== hover?.id || next?.which !== hover?.which) && graph) {
    graph.setDirtyCanvas(true, true)
  }
  hover = next
}

// Inside the gate's top edge -- floating above it would put a hover dead-zone
// between body and glyph and the hover would clear on the way up.
export function glyphRect(gate, n) {
  const g = gateGeom(gate, n)
  return [g.rect[0] + g.rect[2] / 2 - 6, g.rect[1] + 3, 12, 12]
}

// Hit-test a graph point against every gate. zone: 'flip' (hover glyph), 'body'
// (draggable panel), 'pins' (the tooth strip -- left for core's reroute handling).
export function combAt(graph, x, y) {
  for (const comb of records(graph)) {
    const n = comb.lanes.length
    for (const which of ['in', 'out']) {
      const gl = glyphRect(comb[which], n)
      if (
        hover?.id === comb.id && hover.which === which &&
        x >= gl[0] && x <= gl[0] + gl[2] && y >= gl[1] && y <= gl[1] + gl[3]
      ) return { comb, which, zone: 'flip' }
      const [rx, ry, rw, rh] = gateGeom(comb[which], n).rect
      if (x < rx || x > rx + rw || y < ry || y > ry + rh) continue
      const strip = comb[which].pins === 'left' ? x <= rx + 10 : x >= rx + rw - 10
      return { comb, which, zone: strip ? 'pins' : 'body' }
    }
  }
  return null
}

// All tooth creation goes through this: core's LGraph.createReroute seeds the new
// reroute's floatingLinkIds with [before.id] when `before` is a REAL link (latent
// core bug, present 1.47.10 and 1.48.6) and nothing ever prunes the unresolvable
// id. The phantom then (a) blocks core's reroute GC -- totalLinks counts it, so
// dead teeth survive as wireless gate pins -- and (b) VETOES core's
// disconnect-to-float, which is gated on floatingLinkIds.size === 0 (sweep cells
// C/D/M). Scrub any id that does not resolve to an actual floating link.
function mint(graph, before) {
  const r = graph.createReroute([0, 0], before)
  if (r?.floatingLinkIds) {
    for (const id of [...r.floatingLinkIds]) {
      if (!graph.floatingLinks?.has?.(id)) r.floatingLinkIds.delete(id)
    }
  }
  return r
}

// Replace a free reroute with a tooth pair inheriting its chain slot AND its whole
// linkIds set -- a junction reroute becomes one lane feeding all its branches, so
// manifold fan-out survives enrollment.
function absorb(graph, comb, reroute) {
  const tIn = mint(graph, reroute)
  const tOut = mint(graph, reroute)
  if (!tIn || !tOut) return false
  graph.removeReroute(reroute.id)
  comb.lanes.push({ in: tIn.id, out: tOut.id })
  return true
}

const sharesLink = (a, b) => {
  for (const id of a.linkIds ?? []) if (b.linkIds?.has?.(id)) return true
  return false
}

// Reroute dropped onto a reroute: comb is born at the drop point, gates adjacent
// and touching on the ribbon side. The dot that was already there takes lane 0.
export function gestureCreate(graph, target, dragged) {
  if (target === dragged || sharesLink(target, dragged)) return null
  const recs = records(graph, true) // creating: the one place a comb array may be born
  const id = recs.reduce((m, c) => Math.max(m, c.id), 0) + 1
  const [x, y] = target.pos
  const cy = y - PAD - PIN_PITCH / 2
  const comb = {
    id,
    in: { pos: [x - GATE_W, cy], pins: 'left' },
    out: { pos: [x, cy], pins: 'right' },
    lanes: []
  }
  recs.push(comb)
  absorb(graph, comb, target)
  absorb(graph, comb, dragged)
  layout(graph, comb)
  return id
}

// Reroute dropped onto a gate (or onto a tooth): append as the last lane.
export function gestureEnroll(graph, comb, reroute) {
  if (toothIndex.has(reroute.id)) return false
  for (const l of comb.lanes) {
    const t = graph.reroutes.get(l.in)
    if (t && sharesLink(t, reroute)) return false
  }
  const ok = absorb(graph, comb, reroute)
  if (ok) layout(graph, comb)
  return ok
}

// Park an in-flight link drag as a new lane -- the "limbo" state of the spec. The
// dangling side rides core's floating-link machinery: connectFloatingReroute mints
// the floating link and its terminus reroute; the second tooth is a plain
// createReroute insert ahead of it (which also lands in the layout store -- the
// terminus itself needs no core hit-testing, the out-pull gesture owns it). Works
// for fresh drags AND resumed/branched ones (fromReroute chains compose), both
// directions:
//   from an output -> lane floats at the OUT side (terminus = out-tooth)
//   from an input  -> lane floats at the IN side (near-input reroute = out-tooth)
export function gestureFloatingEnroll(graph, lc, comb) {
  const rls = lc?.renderLinks ?? []
  let made = false
  for (const rl of rls) {
    if (!rl?.node?.connectFloatingReroute || !rl.fromSlot) continue
    if (rl.toType !== 'input' && rl.toType !== 'output') continue
    const terminus = rl.node.connectFloatingReroute([0, 0], rl.fromSlot, rl.fromReroute?.id)
    if (!terminus) continue
    const rIn = mint(graph, terminus)
    if (!rIn) continue
    // Chain order is [rIn, terminus] both ways; only which end dangles differs
    // (output-drag: terminus is the would-be input end; input-drag: rIn is the
    // would-be source end and the terminus sits nearest the real input).
    comb.lanes.push({ in: rIn.id, out: terminus.id })
    made = true
  }
  if (made) layout(graph, comb)
  return made
}

// [del] semantics (design decision): the SELECTION decides. Both gates selected -> the
// whole comb dissolves and the links heal plain. One gate selected -> that
// gate's teeth dissolve with it, the partner gate decomposes into plain
// reroutes left standing in its column. Teeth are native reroutes and the
// record rides graph.extra, so undo restores either shape.
export function dissolveComb(graph, comb, sides) {
  const recs = records(graph)
  const i = recs.indexOf(comb)
  if (i < 0) return false
  for (const lane of comb.lanes) {
    if (sides.has('in')) graph.removeReroute(lane.in)
    if (sides.has('out')) graph.removeReroute(lane.out)
  }
  recs.splice(i, 1)
  tplCache.delete(comb.id)
  gateSel.delete(selKey(comb, 'in'))
  gateSel.delete(selKey(comb, 'out'))
  return true
}

// Pulling an in-tooth away detaches its lane: the partner out-tooth dissolves and
// the pulled dot stays under the pointer as a plain reroute ("pulling from 'in'
// disconnects; the dragging reroute IS the tooth"). Out-teeth never detach -- the
// next combPass snaps them home.
export function detachLane(graph, comb, rid) {
  const i = comb.lanes.findIndex((l) => l.in === rid)
  if (i < 0) return false
  const lane = comb.lanes.splice(i, 1)[0]
  graph.removeReroute(lane.out)
  return true
}

// Gate panels, drawn over the links so the fan geometry stays inside the body.
// Teeth do NOT render as reroute dots (suppressed in pathing.js) -- each lane gets
// a node-style pin: a small typed-colour circle straddling the gate's pin edge.
// Record order is base z (selectGate moves a comb's record to the end). SELECTED
// gates render on an overlay canvas stacked ABOVE the DOM node layer -- the main
// canvas sits underneath every Vue node, so "jump on top of nodes" is impossible
// there ("z order still not working", QA find).
function drawGate(ctx, graph, comb, which, sel, canvas) {
  // A gate is half a node, so it wears the node's theme: Comfy's colour palette
  // writes these LiteGraph constants, and reading them at draw time follows every
  // palette switch (audit: no invented colours where a core value exists).
  const L = window.LiteGraph
  const body = L?.NODE_DEFAULT_BGCOLOR ?? '#353535'
  const n = comb.lanes.length
  const g = gateGeom(comb[which], n)
  ctx.beginPath()
  ctx.roundRect(g.rect[0], g.rect[1], g.rect[2], g.rect[3], 5)
  ctx.fillStyle = body
  ctx.fill()
  ctx.strokeStyle = sel ? (L?.NODE_BOX_OUTLINE_COLOR ?? '#fff') : (L?.NODE_DEFAULT_BOXCOLOR ?? '#666')
  ctx.lineWidth = sel ? 1.5 : 1
  ctx.stroke()
  comb.lanes.forEach((l, i) => {
    const t = graph.reroutes?.get?.(l[which])
    ctx.beginPath()
    ctx.arc(g.pinX, g.pinY(i), 4, 0, Math.PI * 2)
    ctx.fillStyle = t?._colour ?? canvas?.default_link_color ?? '#999'
    ctx.fill()
    ctx.strokeStyle = body
    ctx.lineWidth = 1
    ctx.stroke()
  })
  // Flow caret (polish round): the IN gate points pins->ribbon, the OUT gate
  // ribbon->pins -- both read as travel direction, so a comb scans source-to-sink
  // at a glance and the two gates are tellable apart.
  const dir = which === 'in' ? g.ribbonDir : g.pinDir
  const cx = g.rect[0] + g.rect[2] / 2
  const dx = dir === 'right' ? 3 : -3
  ctx.strokeStyle = L?.NODE_TITLE_COLOR ?? '#999'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(cx - dx, g.centerY - 4)
  ctx.lineTo(cx + dx, g.centerY)
  ctx.lineTo(cx - dx, g.centerY + 4)
  ctx.stroke()
  if (hover?.id === comb.id && hover.which === which) {
    // flip glyph: paired chevrons above the gate (no text, path only)
    const [gx, gy, gw, gh] = glyphRect(comb[which], n)
    const cy = gy + gh / 2
    ctx.strokeStyle = L?.NODE_TITLE_COLOR ?? '#999'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(gx + 5, cy - 4); ctx.lineTo(gx + 1, cy); ctx.lineTo(gx + 5, cy + 4)
    ctx.moveTo(gx + gw - 5, cy - 4); ctx.lineTo(gx + gw - 1, cy); ctx.lineTo(gx + gw - 5, cy + 4)
    ctx.stroke()
  }
}

let overlay = null

function overlayCtx(canvas) {
  const src = canvas.canvas
  if (!overlay) {
    overlay = document.createElement('canvas')
    overlay.className = 'cablemanagement-gate-overlay'
    overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:60;'
    document.body.appendChild(overlay)
  }
  const r = src.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr)
  if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h }
  overlay.style.left = `${r.left}px`
  overlay.style.top = `${r.top}px`
  overlay.style.width = `${r.width}px`
  overlay.style.height = `${r.height}px`
  const ctx = overlay.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const { scale, offset } = canvas.ds
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * scale * offset[0], dpr * scale * offset[1])
  return ctx
}

export function clearOverlay() {
  if (overlay) {
    const ctx = overlay.getContext('2d')
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, overlay.width, overlay.height)
  }
}

// ALL gates live on the overlay: node-like z means a gate brought to top STAYS
// above nodes after deselection, and the main canvas can never paint above the
// DOM node layer. Record order is base z, selected gates draw last. The ribbon
// stays on the main canvas (under nodes, like links); the gate body covers its
// own fan from above either way.
export function drawGates(ctx, graph, canvas) {
  const recs = graph?.extra?.[KEY]
  if (!Array.isArray(recs) || !recs.length || !canvas) {
    clearOverlay()
    return
  }
  const gates = []
  for (const comb of recs) {
    gates.push([comb, 'in'], [comb, 'out'])
  }
  gates.sort((a, b) => (isGateSelected(a[0], a[1]) ? 1 : 0) - (isGateSelected(b[0], b[1]) ? 1 : 0))
  const octx = overlayCtx(canvas)
  for (const [comb, which] of gates) {
    drawGate(octx, graph, comb, which, isGateSelected(comb, which), canvas)
  }
}

// ---- programmatic API (PoC; gesture layer comes later) -------------------------

function enroll(graph, comb, linkId) {
  const link = graph._links.get(Number(linkId))
  if (!link) return false
  // Two inserts before the final segment chain source -> in -> out -> target.
  const tIn = mint(graph, link)
  const tOut = mint(graph, link)
  if (!tIn || !tOut) return false
  comb.lanes.push({ in: tIn.id, out: tOut.id })
  return true
}

export function installApi(app) {
  // The graph ON SCREEN, not the root -- inside a subgraph app.graph still points at
  // the root, and a comb created there would enroll root links from subgraph
  // coordinates (cross-graph corruption, persisted on save).
  const g = () => activeGraph(app)
  const dirty = () => activeGraph(app)?.setDirtyCanvas(true, true)
  const find = (id) => records(g()).find((c) => c.id === id)

  const api = {
    create(linkIdA, linkIdB, x, y) {
      const recs = records(g(), true)
      const id = recs.reduce((m, c) => Math.max(m, c.id), 0) + 1
      const comb = {
        id,
        in: { pos: [x, y], pins: 'left' },
        out: { pos: [x + GATE_W, y], pins: 'right' }, // adjacent, touching ribbon faces
        lanes: []
      }
      recs.push(comb)
      enroll(g(), comb, linkIdA)
      enroll(g(), comb, linkIdB)
      layout(g(), comb)
      dirty()
      return id
    },
    add(combId, linkId) {
      const comb = find(combId)
      if (!comb) return false
      const ok = enroll(g(), comb, linkId)
      if (ok) layout(g(), comb)
      dirty()
      return ok
    },
    remove(combId, linkId) {
      const comb = find(combId)
      if (!comb) return false
      const i = comb.lanes.findIndex((l) =>
        g().reroutes.get(l.in)?.linkIds?.has?.(Number(linkId))
      )
      if (i < 0) return false
      const l = comb.lanes.splice(i, 1)[0]
      g().removeReroute(l.in) // splices the chain; the link keeps flowing plain
      g().removeReroute(l.out)
      // A one-lane comb is no comb: combPass decomposes it, teeth become reroutes.
      dirty()
      return true
    },
    decompose(combId) {
      const recs = records(g())
      const i = recs.findIndex((c) => c.id === combId)
      if (i < 0) return false
      tplCache.delete(recs[i].id)
      recs.splice(i, 1)
      dirty()
      return true
    },
    move(combId, which, x, y) {
      const comb = find(combId)
      if (!comb || !comb[which]) return false
      comb[which].pos = [x, y]
      layout(g(), comb)
      dirty()
      return true
    },
    flip(combId, which) {
      const comb = find(combId)
      if (!comb || !comb[which]) return false
      comb[which].pins = comb[which].pins === 'left' ? 'right' : 'left'
      layout(g(), comb)
      dirty()
      return true
    },
    list() {
      return records(g()).map((c) => ({
        id: c.id,
        in: c.in,
        out: c.out,
        lanes: c.lanes.map((l) => ({ ...l }))
      }))
    },
    selection() {
      return gateSelectionKeys()
    }
  }
  window.__cablemanagementCombs = api
  return api
}
