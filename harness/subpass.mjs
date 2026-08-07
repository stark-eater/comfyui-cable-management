// Passthrough x subgraph (Barney's QA: gates + conversion).
// (A) pin with a real inside origin dropped on the OUTPUT GATE: link lands, record
//     in graph.extra (a gate has no properties bag -- writing one used to crash),
//     wire draws from the pin;
// (B) consumer input-drag dropped on a BOUNDARY-ORIGIN pin connects from the input
//     gate slot (was an explicit bail), with provenance + pin draw;
// (C) converting a pin HOST remaps the outside consumer's provenance onto the
//     subgraph node's own pin -- no revealed sibling link;
// (D) converting a WIDGET pin host adopts the owned primitive into the set: the
//     consumer rides a new subgraph output and the value reaches the prompt.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e.stack ?? e).split(String.fromCharCode(10)).slice(0, 6).join(' <- ')))
const boot = async () => {
  await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForFunction(() => window.app?.graph && window.__cablemanagementPathing?.state?.patched, null, { timeout: 120_000 })
  await page.waitForTimeout(3000)
}
await boot()

let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}
const settle = () => page.evaluate(async () => {
  const g = window.app.canvas.graph
  window.__cablemanagementCapture = true
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
})
const frame = () => page.evaluate(async () => {
  const g = window.app.canvas.graph, ds = window.app.canvas.ds
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
  const rects = [...g.nodes.map((n) => [n.pos[0], n.pos[1], n.size?.[0] ?? 200, n.size?.[1] ?? 100])]
  if (g.inputNode?.boundingRect) rects.push([...g.inputNode.boundingRect])
  if (g.outputNode?.boundingRect) rects.push([...g.outputNode.boundingRect])
  for (const [x, y, w, h] of rects) {
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h)
  }
  const scale = Math.min(1, 1700 / (maxX - minX + 200), 850 / (maxY - minY + 200))
  ds.scale = scale
  ds.offset[0] = -minX + 120 / scale
  ds.offset[1] = -minY + 120 / scale
  g.setDirtyCanvas(true, true)
  window.dispatchEvent(new Event('resize'))
  await new Promise((r) => setTimeout(r, 1200))
})
const pinPos = (nodeId, kind, index) => page.evaluate(([nodeId, kind, index]) => {
  const p = [...document.querySelectorAll('.cablemanagement-pin')].find(
    (x) => x.dataset.cablemanagementNode === nodeId && x.dataset.cablemanagementKind === kind &&
      (index == null || x.dataset.cablemanagementIndex === String(index))
  )
  if (!p) return null
  const r = p.getBoundingClientRect()
  return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, [nodeId, kind, index ?? null])
const anchorOfPin = (nodeId, kind, index) => page.evaluate(([nodeId, kind, index]) => {
  const g = window.app.canvas.graph
  const node = g.getNodeById(Number(nodeId))
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    (x) => x.dataset.cablemanagementNode === nodeId && x.dataset.cablemanagementKind === kind &&
      (index == null || x.dataset.cablemanagementIndex === String(index))
  )
  if (!el || !node) return null
  const T = window.LiteGraph?.NODE_TITLE_HEIGHT ?? 30
  return [node.pos[0] + el.offsetLeft + el.offsetWidth / 2, node.pos[1] - T + el.offsetTop + el.offsetHeight / 2]
}, [nodeId, kind, index ?? null])
const slotPos = (key) => page.evaluate((key) => {
  const d = document.querySelector(`[data-slot-key="${key}"]`)
  if (!d) return null
  const r = d.getBoundingClientRect()
  return [r.x + r.width / 2, r.y + r.height / 2]
}, key)
const gateSlotPos = (which, slotIdx) => page.evaluate(([which, slotIdx]) => {
  const c = window.app.canvas
  const io = which === 'in' ? c.graph.inputNode : c.graph.outputNode
  const slot = slotIdx === 'empty' ? io.emptySlot : io.slots[slotIdx]
  const r = slot?.boundingRect
  if (!r) return null
  const view = c.canvas.getBoundingClientRect()
  return [
    view.left + (r[0] + r[2] * 0.5 + c.ds.offset[0]) * c.ds.scale,
    view.top + (r[1] + r[3] * 0.5 + c.ds.offset[1]) * c.ds.scale,
  ]
}, [which, slotIdx])
const drag = async (from, to) => {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  await page.mouse.move(from[0] + 30, from[1] + 15, { steps: 4 })
  await page.mouse.move(to[0], to[1], { steps: 12 })
  await page.waitForTimeout(300)
  await page.mouse.up()
  await page.waitForTimeout(500)
  const menu = await page.evaluate(() => !!document.querySelector('.litecontextmenu'))
  if (menu) { await page.mouse.click(200, 950); await page.waitForTimeout(300) }
  await settle()
}
const near = (a, b) => a && b && Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) < 1

// ---- scene for (A)+(B): X->H and F->H2, convert all but F, work inside ----
const s = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const X = mk('CheckpointLoaderSimple', 100, 100)
  const H = mk('CheckpointSave', 700, 100)
  const F = mk('CheckpointLoaderSimple', 100, 600)
  const H2 = mk('CheckpointSave', 700, 600)
  X.connect(0, H, 0)
  F.connect(0, H2, 0)
  const { subgraph } = g.convertToSubgraph(new Set([X, H, H2]))
  await new Promise((r) => setTimeout(r, 500))
  app.canvas.openSubgraph(subgraph)
  await new Promise((r) => setTimeout(r, 1500))
  const sg = app.canvas.graph
  const ids = {}
  for (const n of sg.nodes) {
    if (n.type === 'CheckpointLoaderSimple') ids.X = String(n.id)
    else if (n.inputs?.[0]?.link != null && Number(sg.getLink(n.inputs[0].link)?.origin_id) === -10) ids.H2 = String(n.id)
    else ids.H = String(n.id)
  }
  return ids
})
await frame()
await settle()

// (A) pin with real inside origin -> output gate
await drag(await pinPos(s.H, 'link', 0), await gateSlotPos('out', 'empty'))
let st = await page.evaluate((s) => {
  const sg = window.app.canvas.graph
  const lid = sg.outputs[0]?.linkIds?.[0]
  const link = lid != null ? sg.getLink(lid) : null
  const d = lid != null ? window.__cablemanagementDraw?.get?.(lid) : null
  return {
    outputs: sg.outputs.length,
    origin: link ? String(link.origin_id) : null,
    rec: sg.extra?.cablemanagement_gatefrom?.[String(lid)] ?? null,
    draw: d ? [d[0], d[1]] : null,
  }
}, s)
let anchor = await anchorOfPin(s.H, 'link', 0)
ok('gate drop lands from the true origin', st.outputs === 1 && st.origin === s.X, JSON.stringify(st))
ok('gate record on the pin', st.rec?.[0] === s.H && st.rec?.[1] === 0, JSON.stringify(st.rec))
ok('gate link draws from the pin', near(st.draw, anchor), `drawn=${st.draw} pin=${anchor}`)
ok('no recordProvenance crash', !errs.some((e) => /Cannot set properties/.test(e)), errs.join(' | '))

// (B) consumer drag dropped ON a boundary-origin pin
const cId = await page.evaluate(() => {
  const sg = window.app.canvas.graph, L = window.LiteGraph
  const C = L.createNode('CheckpointSave')
  C.pos = [1300, 900]
  sg.add(C)
  return String(C.id)
})
await frame()
await settle()
await drag(await slotPos(`${cId}-in-0`), await pinPos(s.H2, 'link', 0))
st = await page.evaluate(([cId]) => {
  const sg = window.app.canvas.graph
  const C = sg.getNodeById(Number(cId))
  const link = C.inputs[0].link != null ? sg.getLink(C.inputs[0].link) : null
  const d = link ? window.__cablemanagementDraw?.get?.(link.id) : null
  return {
    origin: link ? String(link.origin_id) : null,
    originSlot: link ? link.origin_slot : null,
    prov: C.properties?.['cablemanagement.from']?.['0'] ?? null,
    draw: d ? [d[0], d[1]] : null,
  }
}, [cId])
anchor = await anchorOfPin(s.H2, 'link', 0)
ok('boundary pin feeds from the gate slot', st.origin === '-10' && st.originSlot === 0, JSON.stringify(st))
ok('boundary-pin provenance points at the pin', st.prov?.[0] === s.H2, JSON.stringify(st.prov))
ok('boundary-pin link draws from the pin', near(st.draw, anchor), `drawn=${st.draw} pin=${anchor}`)

// (E) gate-to-gate via pin: H2's pin (origin = input gate) dragged onto the
// output gate -- a branded invisible Reroute must bridge the gates, drawn with
// the primitive treatment (out-segment from the pin, in-segment suppressed).
await drag(await pinPos(s.H2, 'link', 0), await gateSlotPos('out', 'empty'))
await page.evaluate(() => { window.__cablemanagementDraw = new Map() })
await settle()
st = await page.evaluate(() => {
  const sg = window.app.canvas.graph
  const R = sg.nodes.find((n) => n.type === 'Reroute' && n.properties?.['cablemanagement.stitch'] === true)
  if (!R) return { stitch: false, outputs: sg.outputs.length }
  const inL = R.inputs[0].link != null ? sg.getLink(R.inputs[0].link) : null
  const outL = R.outputs[0].links?.length ? sg.getLink(R.outputs[0].links[0]) : null
  const el = document.querySelector(`.lg-node[data-node-id="${R.id}"]`)
  const outDraw = outL ? window.__cablemanagementDraw?.get?.(outL.id) : null
  return {
    stitch: true,
    R: String(R.id),
    outputs: sg.outputs.length,
    inOrigin: inL ? String(inL.origin_id) : null,
    inSlot: inL ? inL.origin_slot : null,
    outTarget: outL ? String(outL.target_id) : null,
    hidden: el ? el.style.visibility === 'hidden' : null,
    from: R.properties?.['cablemanagement.stitchFrom'] ?? null,
    outDraw: outDraw ? [outDraw[0], outDraw[1]] : null,
    inDrawn: inL ? window.__cablemanagementDraw?.has?.(inL.id) === true : null,
  }
})
const eR = st.R
anchor = await anchorOfPin(s.H2, 'link', 0)
ok('stitch reroute bridges the gates', st.stitch && st.inOrigin === '-10' && st.inSlot === 0 && st.outTarget === '-20', JSON.stringify(st))
ok('stitch created a subgraph output', st.outputs === 2, `outputs=${st.outputs}`)
ok('stitch is invisible', st.hidden === true, JSON.stringify(st.hidden))
ok('stitch records the pin', st.from?.[0] === s.H2 && st.from?.[1] === 0, JSON.stringify(st.from))
ok('stitch out-segment draws from the pin', near(st.outDraw, anchor), `drawn=${st.outDraw} pin=${anchor}`)
ok('stitch in-segment is suppressed', st.inDrawn === false, JSON.stringify(st.inDrawn))
ok('no core Not-implemented leak', !errs.some((e) => /Not implemented/.test(e)), errs.join(' | '))

// (F) hand-drawn gate-to-gate: drag from the input gate slot straight to the
// output gate -- core's own dead gesture, rescued by the same seam.
await drag(await gateSlotPos('in', 0), await gateSlotPos('out', 'empty'))
st = await page.evaluate((eR) => {
  const sg = window.app.canvas.graph
  const stitches = sg.nodes.filter((n) => n.type === 'Reroute' && n.properties?.['cablemanagement.stitch'] === true)
  return { count: stitches.length, outputs: sg.outputs.length, ids: stitches.map((n) => String(n.id)) }
}, eR)
ok('hand gate-to-gate stitches too', st.count === 2 && st.outputs === 3, JSON.stringify(st))

// reap: unbridge the first stitch -- machinery with no job must vanish
st = await page.evaluate(async (eR) => {
  const sg = window.app.canvas.graph
  sg.getNodeById(Number(eR))?.disconnectInput(0)
  // A bare link removal mutates no DOM the sync observer watches; real gestures
  // end in cablemanagement:resync, so emit the same signal here.
  window.dispatchEvent(new CustomEvent('cablemanagement:resync'))
  await new Promise((r) => setTimeout(r, 300))
  return true
}, eR)
await settle()
st = await page.evaluate((eR) => {
  const sg = window.app.canvas.graph
  return { gone: !sg.getNodeById(Number(eR)), remaining: sg.nodes.filter((n) => n.properties?.['cablemanagement.stitch']).length }
}, eR)
ok('unbridged stitch is reaped', st.gone && st.remaining === 1, JSON.stringify(st))

// ---- (C) convert a pin HOST: provenance remaps onto the subgraph node ----
await boot()
let c = await page.evaluate(() => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CheckpointLoaderSimple', 100, 100)
  const B = mk('CheckpointSave', 700, 100)
  const C = mk('CheckpointSave', 700, 600)
  A.connect(0, B, 0)
  return { A: String(A.id), B: String(B.id), C: String(C.id) }
})
await frame()
await settle()
await drag(await slotPos(`${c.C}-in-0`), await pinPos(c.B, 'link', 0))
let setup = await page.evaluate((c) => {
  const g = window.app.graph
  const C = g.getNodeById(Number(c.C))
  return { linked: C.inputs[0].link != null, prov: C.properties?.['cablemanagement.from']?.['0'] ?? null }
}, c)
ok('C-setup: pin drop wired with provenance', setup.linked && setup.prov?.[0] === c.B, JSON.stringify(setup))
st = await page.evaluate(async (c) => {
  const g = window.app.graph
  const B = g.getNodeById(Number(c.B))
  const { node } = g.convertToSubgraph(new Set([B]))
  await new Promise((r) => setTimeout(r, 800))
  const C = g.getNodeById(Number(c.C))
  const link = C.inputs[0].link != null ? g.getLink(C.inputs[0].link) : null
  return {
    sub: String(node.id),
    origin: link ? String(link.origin_id) : null,
    linkId: link?.id ?? null,
    prov: C.properties?.['cablemanagement.from']?.['0'] ?? null,
  }
}, c)
await settle()
const draw = await page.evaluate((c) => {
  const g = window.app.graph
  const C = g.getNodeById(Number(c.C))
  const lid = C.inputs[0].link
  const d = lid != null ? window.__cablemanagementDraw?.get?.(lid) : null
  return { d: d ? [d[0], d[1]] : null, provAfterSync: C.properties?.['cablemanagement.from']?.['0'] ?? null }
}, c)
anchor = await anchorOfPin(st.sub, 'link', 0)
ok('convert keeps the sibling link', st.origin === c.A, JSON.stringify(st))
ok('provenance remapped onto the subgraph node', draw.provAfterSync?.[0] === st.sub && draw.provAfterSync?.[1] === 0, JSON.stringify(draw.provAfterSync))
ok('wire hangs off the subgraph node pin', near(draw.d, anchor), `drawn=${draw.d} pin=${anchor}`)

// ---- (D) convert a WIDGET pin host: primitive adopted, value survives ----
c = await page.evaluate(() => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const B2 = mk('CLIPTextEncode', 100, 300)
  const C2 = mk('CLIPTextEncode', 1300, 300)
  B2.widgets.find((w) => w.name === 'text').value = 'adoption probe'
  const k = C2.inputs.findIndex((x) => x.widget?.name === 'text')
  return { B2: String(B2.id), C2: String(C2.id), k }
})
await frame()
await settle()
await drag(await slotPos(`${c.C2}-in-${c.k}`), await pinPos(c.B2, 'widget'))
setup = await page.evaluate((c) => {
  const g = window.app.graph
  const prim = g.nodes.find((n) => n.type === 'PrimitiveNode')
  const C2 = g.getNodeById(Number(c.C2))
  return { prim: !!prim, linked: C2.inputs[c.k].link != null }
}, c)
ok('D-setup: primitive + consumer link', setup.prim && setup.linked, JSON.stringify(setup))
// Conversion AUTO-PROMOTES the widget (inner input gains a gate link, the
// subgraph node grows a proxy widget). Adoption carries the primitive and its
// consumer link through the conversion tick, then the coverage pass sees the
// promoted link, migrates the consumer feed onto a stitch from the promoted
// input, and reaps the now-stale machinery. End state: fully live, no primitive.
st = await page.evaluate(async (c) => {
  const g = window.app.graph
  const B2 = g.getNodeById(Number(c.B2))
  const { subgraph, node } = g.convertToSubgraph(new Set([B2]))
  await new Promise((r) => setTimeout(r, 1200))
  const C2 = g.getNodeById(Number(c.C2))
  const link = C2.inputs[c.k].link != null ? g.getLink(C2.inputs[c.k].link) : null
  const R = subgraph.nodes.find((n) => n.properties?.['cablemanagement.stitch'] === true)
  const p = await window.app.graphToPrompt()
  const w = node.widgets?.find((x) => x.name === 'text')
  let editedText = null
  if (w) {
    w.value = 'edited live'
    const p2 = await window.app.graphToPrompt()
    editedText = p2.output[c.C2]?.inputs?.text ?? null
  }
  return {
    primAnywhere:
      g.nodes.some((n) => n.type === 'PrimitiveNode') ||
      subgraph.nodes.some((n) => n.type === 'PrimitiveNode'),
    stitched: !!R,
    subOutputs: subgraph.outputs.length,
    fedFromSub: link ? String(link.origin_id) === String(node.id) : false,
    cText: p.output[c.C2]?.inputs?.text,
    editedText,
  }
}, c)
ok('adoption bridges, coverage migrates to a stitch, machinery reaped', !st.primAnywhere && st.stitched, JSON.stringify(st))
ok('consumer rides a new subgraph output', st.subOutputs === 1 && st.fedFromSub, JSON.stringify(st))
ok('promoted widget value reaches the prompt', st.cText === 'adoption probe', JSON.stringify(st.cText))
ok('editing the promoted widget flows LIVE to the consumer', st.editedText === 'edited live', JSON.stringify(st.editedText))

// ---- (G) BP2-sg shape: widget literal through gate -> STITCH -> gate to an
// outside forceInput consumer. The flattener walks the chain back to the virtual
// primitive and discards the link; delivery must hop THROUGH the virtual Reroute
// (it has no prompt entry to inject into) and land the literal on the consumer.
c = await page.evaluate(() => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const W = mk('CLIPTextEncode', 100, 300)
  const T = mk('ShowText|pysssss', 1300, 300)
  W.widgets.find((x) => x.name === 'text').value = 'stitch relay'
  return { W: String(W.id), T: String(T.id) }
})
await frame()
await settle()
await drag(await slotPos(`${c.T}-in-0`), await pinPos(c.W, 'widget'))
st = await page.evaluate(async (c) => {
  const g = window.app.graph, L = window.LiteGraph
  const T = g.getNodeById(Number(c.T))
  if (T.inputs[0].link == null) return { setup: false }
  const { subgraph, node } = g.convertToSubgraph(new Set([T]))
  await new Promise((r) => setTimeout(r, 800))
  // stitch the input straight to a fresh output, API-built (the gesture itself
  // is covered by cases E/F)
  const R = L.createNode('Reroute')
  subgraph.add(R)
  R.properties['cablemanagement.stitch'] = true
  subgraph.inputNode.slots[0].connect(R.inputs[0], R)
  subgraph.addOutput('text', 'STRING')
  subgraph.outputNode.slots[subgraph.outputNode.slots.length - 1].connect(R.outputs[0], R)
  await new Promise((r) => setTimeout(r, 300))
  const S2 = L.createNode('ShowText|pysssss')
  S2.pos = [2000, 300]
  g.add(S2)
  node.connect(node.outputs.length - 1, S2, 0)
  await new Promise((r) => setTimeout(r, 300))
  const p = await window.app.graphToPrompt()
  return {
    setup: true,
    s2Text: p.output[String(S2.id)]?.inputs?.text ?? null,
  }
}, c)
ok('G-setup: pin drop + conversion', st.setup === true, JSON.stringify(st))
ok('literal survives gate -> stitch -> gate to a forceInput consumer', st.s2Text === 'stitch relay', JSON.stringify(st.s2Text))

// ---- (H) COVERAGE MIGRATION (Barney's remove_weights case): widget pin pulled
// to the output gate FIRST (owned primitive republishes the literal), THEN a
// gate link covers the widget input. The primitive's literal is stale from that
// moment -- consumers must migrate to the live origin (here: a stitch) and the
// primitive must die. Built cover-first this already worked; order must not matter.
let h = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const T2 = L.createNode('CLIPTextEncode')
  T2.pos = [500, 300]
  g.add(T2)
  T2.widgets.find((x) => x.name === 'text').value = 'stale seed'
  const { subgraph, node } = g.convertToSubgraph(new Set([T2]))
  await new Promise((r) => setTimeout(r, 500))
  // conversion auto-promotes the widget; UN-promote so the widget is genuinely
  // uncovered inside -- that is the remove_weights premise (gate slot 0 stays,
  // dangling, and is re-used by the cover step below)
  const inner = subgraph.nodes[0]
  const k = inner.inputs.findIndex((x) => x.widget?.name === 'text')
  inner.disconnectInput(k)
  app.canvas.openSubgraph(subgraph)
  await new Promise((r) => setTimeout(r, 1500))
  return { inner: String(inner.id), sub: String(node.id), k }
})
await frame()
await settle()
await drag(await pinPos(h.inner, 'widget'), await gateSlotPos('out', 'empty'))
st = await page.evaluate((h) => {
  const sg = window.app.canvas.graph
  const prim = sg.nodes.find((n) => n.type === 'PrimitiveNode')
  return { prim: !!prim, outputs: sg.outputs.length }
}, h)
ok('H-setup: primitive republishes to the gate', st.prim && st.outputs === 1, JSON.stringify(st))
st = await page.evaluate(async (h) => {
  const sg = window.app.canvas.graph
  const T2 = sg.getNodeById(Number(h.inner))
  sg.inputs[0].connect(T2.inputs[h.k], T2) // re-cover via the dangling promoted slot
  window.dispatchEvent(new CustomEvent('cablemanagement:resync'))
  await new Promise((r) => setTimeout(r, 400))
  return true
}, h)
await settle()
st = await page.evaluate((h) => {
  const sg = window.app.canvas.graph
  const prim = sg.nodes.find((n) => n.type === 'PrimitiveNode')
  const R = sg.nodes.find((n) => n.properties?.['cablemanagement.stitch'] === true)
  const inL = R?.inputs?.[0]?.link != null ? sg.getLink(R.inputs[0].link) : null
  const outL = R?.outputs?.[0]?.links?.length ? sg.getLink(R.outputs[0].links[0]) : null
  return {
    primGone: !prim,
    stitched: !!R && inL && String(inL.origin_id) === '-10' && outL && String(outL.target_id) === '-20',
    from: R?.properties?.['cablemanagement.stitchFrom'] ?? null,
  }
}, h)
ok('coverage migrates the gate consumer to a stitch', st.stitched === true, JSON.stringify(st))
ok('stale primitive is reaped', st.primGone === true, JSON.stringify(st))
ok('migrated stitch keeps the pin picture', st.from?.[0] === h.inner, JSON.stringify(st.from))
// live value end-to-end: feed the subgraph input from a root widget pin, read the
// output. Exit via the hash route -- the navigation store keys off it; a bare
// setGraph leaves the Vue layer rendering the subgraph and root slot DOM missing.
await page.evaluate(() => { location.hash = '#' + window.app.graph.id })
await page.waitForTimeout(1500)
const w3 = await page.evaluate(() => {
  const g = window.app.graph, L = window.LiteGraph
  const W3 = L.createNode('CLIPTextEncode')
  W3.pos = [100, 800]
  g.add(W3)
  W3.widgets.find((x) => x.name === 'text').value = 'live value'
  return String(W3.id)
})
await frame()
await settle()
await drag(await slotPos(`${h.sub}-in-0`), await pinPos(w3, 'widget'))
st = await page.evaluate(async (h) => {
  const g = window.app.graph, L = window.LiteGraph
  const S3 = L.createNode('ShowText|pysssss')
  S3.pos = [2000, 800]
  g.add(S3)
  g.getNodeById(Number(h.sub)).connect(0, S3, 0)
  window.dispatchEvent(new CustomEvent('cablemanagement:resync'))
  await new Promise((r) => setTimeout(r, 400))
  const p = await window.app.graphToPrompt()
  return { s3Text: p.output[String(S3.id)]?.inputs?.text ?? null }
}, h)
ok('output follows the live value, not the stale literal', st.s3Text === 'live value', JSON.stringify(st.s3Text))

// reverse inside the (closed) subgraph: drop the covering gate link -- dependents
// revert to a rematerialised primitive and the literal ships again
st = await page.evaluate(async (h) => {
  const g = window.app.graph
  const sub = g.getNodeById(Number(h.sub)).subgraph
  sub.getNodeById(Number(h.inner)).disconnectInput(h.k)
  window.dispatchEvent(new CustomEvent('cablemanagement:resync'))
  await new Promise((r) => setTimeout(r, 500))
  const prim = sub.nodes.find((n) => n.type === 'PrimitiveNode' && n.properties?.['cablemanagement.owned'])
  const R = sub.nodes.find((n) => n.properties?.['cablemanagement.stitch'] === true)
  const gateLink = sub.outputs[0]?.linkIds?.length ? sub.getLink(sub.outputs[0].linkIds[0]) : null
  const S3 = g.nodes.find((n) => n.type === 'ShowText|pysssss')
  const p = await window.app.graphToPrompt()
  return {
    prim: !!prim,
    gateFedByPrim: gateLink && prim ? String(gateLink.origin_id) === String(prim.id) : false,
    stitchBridged: R ? (R.outputs?.[0]?.links?.length ?? 0) > 0 : false,
    s3Text: S3 ? p.output[String(S3.id)]?.inputs?.text ?? null : null,
  }
}, h)
ok('uncover in a closed subgraph rematerialises the primitive', st.prim && st.gateFedByPrim, JSON.stringify(st))
ok('the stitch is unbridged', st.stitchBridged === false, JSON.stringify(st.stitchBridged))
// The queue above HEALED the hop-consumer's widget to 'live value' (High-3 fix:
// injectLiterals writes consumer widgets at queue time so saved files ship the
// truth). Rematerialise seeds from the host's CURRENT value, so the reverted
// literal is the healed one -- 'stale seed' is gone by design, not by accident.
ok('the literal ships again (healed value)', st.s3Text === 'live value', JSON.stringify(st.s3Text))

// ---- (I) plain graph, no subgraph (the general contract): consumer on A's
// widget pin, then a real link covers A's input -- consumer re-feeds from it.
let ij = await page.evaluate(() => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CLIPTextEncode', 100, 300)
  const C = mk('CLIPTextEncode', 1300, 300)
  const S0 = mk('ShowText|pysssss', 100, 700)
  A.widgets.find((x) => x.name === 'text').value = 'stale'
  const k = A.inputs.findIndex((x) => x.widget?.name === 'text')
  const ck = C.inputs.findIndex((x) => x.widget?.name === 'text')
  return { A: String(A.id), C: String(C.id), S0: String(S0.id), k, ck }
})
await frame()
await settle()
await drag(await slotPos(`${ij.C}-in-${ij.ck}`), await pinPos(ij.A, 'widget'))
st = await page.evaluate(async (ij) => {
  const g = window.app.graph
  const prim = g.nodes.find((n) => n.type === 'PrimitiveNode' && n.properties?.['cablemanagement.owned'])
  if (!prim) return { setup: false }
  const A = g.getNodeById(Number(ij.A))
  const S0 = g.getNodeById(Number(ij.S0))
  S0.connect(0, A, ij.k)
  window.dispatchEvent(new CustomEvent('cablemanagement:resync'))
  await new Promise((r) => setTimeout(r, 400))
  const C = g.getNodeById(Number(ij.C))
  const link = C.inputs[ij.ck].link != null ? g.getLink(C.inputs[ij.ck].link) : null
  return {
    setup: true,
    primGone: !g.nodes.some((n) => n.type === 'PrimitiveNode' && n.properties?.['cablemanagement.owned']),
    origin: link ? String(link.origin_id) : null,
    prov: C.properties?.['cablemanagement.from']?.[String(ij.ck)] ?? null,
  }
}, ij)
ok('plain coverage migrates the consumer to the new origin', st.setup && st.primGone && st.origin === ij.S0, JSON.stringify(st))
ok('plain coverage keeps the pin picture', st.prov?.[0] === ij.A, JSON.stringify(st.prov))

// ---- (J) plain reverse: dropping the covering link reverts the consumer to a
// rematerialised primitive republishing the literal.
st = await page.evaluate(async (ij) => {
  const g = window.app.graph
  g.getNodeById(Number(ij.A)).disconnectInput(ij.k)
  window.dispatchEvent(new CustomEvent('cablemanagement:resync'))
  await new Promise((r) => setTimeout(r, 400))
  const C = g.getNodeById(Number(ij.C))
  const link = C.inputs[ij.ck].link != null ? g.getLink(C.inputs[ij.ck].link) : null
  const prim = g.nodes.find((n) => n.type === 'PrimitiveNode' && n.properties?.['cablemanagement.owned'])
  const p = await window.app.graphToPrompt()
  return {
    prim: prim ? String(prim.id) : null,
    origin: link ? String(link.origin_id) : null,
    prov: C.properties?.['cablemanagement.from']?.[String(ij.ck)] ?? null,
    cText: p.output[ij.C]?.inputs?.text ?? null,
  }
}, ij)
ok('uncover reverts the consumer to a primitive', !!st.prim && st.origin === st.prim, JSON.stringify(st))
ok('reverted provenance still names the pin', st.prov?.[0] === ij.A, JSON.stringify(st.prov))
ok('reverted literal ships in the prompt', st.cText === 'stale', JSON.stringify(st.cText))

// ---- (K) subgraph UNPACK strands the stitch mid-wire in the parent -- an
// invisible node kinking a real link. Heal to a direct link, reap the stitch.
const kc = await page.evaluate(() => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const W = mk('CLIPTextEncode', 100, 300)
  const T = mk('ShowText|pysssss', 1300, 300)
  W.widgets.find((x) => x.name === 'text').value = 'unpack probe'
  return { W: String(W.id), T: String(T.id) }
})
await frame()
await settle()
await drag(await slotPos(`${kc.T}-in-0`), await pinPos(kc.W, 'widget'))
st = await page.evaluate(async (kc) => {
  const g = window.app.graph, L = window.LiteGraph
  const T = g.getNodeById(Number(kc.T))
  if (T.inputs[0].link == null) return { setup: false }
  const { subgraph, node } = g.convertToSubgraph(new Set([T]))
  await new Promise((r) => setTimeout(r, 800))
  const R = L.createNode('Reroute')
  subgraph.add(R)
  R.properties['cablemanagement.stitch'] = true
  subgraph.inputNode.slots[0].connect(R.inputs[0], R)
  subgraph.addOutput('text', 'STRING')
  subgraph.outputNode.slots[subgraph.outputNode.slots.length - 1].connect(R.outputs[0], R)
  const S2 = L.createNode('ShowText|pysssss')
  S2.pos = [2000, 300]
  g.add(S2)
  node.connect(node.outputs.length - 1, S2, 0)
  await new Promise((r) => setTimeout(r, 300))
  g.unpackSubgraph(node)
  window.dispatchEvent(new CustomEvent('cablemanagement:resync'))
  await new Promise((r) => setTimeout(r, 600))
  const prim = g.nodes.find((n) => n.type === 'PrimitiveNode' && n.properties?.['cablemanagement.owned'])
  const strays = g.nodes.filter((n) => n.properties?.['cablemanagement.stitch'] === true).length
  const s2link = S2.inputs[0].link != null ? g.getLink(S2.inputs[0].link) : null
  const p = await window.app.graphToPrompt()
  return {
    setup: true,
    strays,
    s2Origin: s2link ? String(s2link.origin_id) : null,
    primId: prim ? String(prim.id) : null,
    s2Text: p.output[String(S2.id)]?.inputs?.text ?? null,
  }
}, kc)
ok('K-setup: unpack ran', st.setup === true, JSON.stringify(st))
ok('stranded stitch healed away', st.strays === 0, JSON.stringify(st))
ok('consumer healed onto the true source', !!st.primId && st.s2Origin === st.primId, JSON.stringify(st))
ok('value survives the unpack', st.s2Text === 'unpack probe', JSON.stringify(st.s2Text))

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
