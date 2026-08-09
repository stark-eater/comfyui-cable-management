// Passthrough x floating reroutes (Barney's QA, three items):
// (1) drops onto floating reroutes connect: core's Vue drop path reads the
//     layout store, and setReroute (behind the link-release menu's "Add
//     Reroute") never registers there -- the cablemanagement dropOnNothing belt resolves
//     reroutes from graph truth. Both float directions complete with their
//     natural counterpart (consumer drag onto a source-attached float; source
//     drag onto a target-attached float).
// (2a) an input-passthrough pull parked as a floating reroute DRAWS from the
//     passthrough pin, not the datasource output; completing through the chain
//     inherits pin provenance (recorded on the chain's reroute in graph.extra).
// (2b) same for a widget-passthrough pull: the float draws from the widget pin,
//     not the parked primitive's slot; core stamps _dragging on floats as a
//     style flag, which used to veto ledger substitution.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagementPathing?.state?.patched && window.__cablemanagementCombs, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}
const settle = () => page.evaluate(async () => {
  const g = window.app.graph
  window.__cablemanagementCapture = true
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
})
const screenOfGraph = (gx, gy) => page.evaluate(([gx, gy]) => {
  const { ds } = window.app.canvas
  return [(gx + ds.offset[0]) * ds.scale, (gy + ds.offset[1]) * ds.scale]
}, [gx, gy])
const screenOfSlot = (key) => page.evaluate((key) => {
  const d = document.querySelector(`[data-slot-key="${key}"]`)
  if (!d) return null
  const r = d.getBoundingClientRect()
  return [r.x + r.width / 2, r.y + r.height / 2]
}, key)
const cablemanagementPin = (nodeId, kind) => page.evaluate(([nodeId, kind]) => {
  const p = [...document.querySelectorAll('.cablemanagement-pin')].find(
    (x) => x.dataset.cablemanagementNode === nodeId && x.dataset.cablemanagementKind === kind
  )
  if (!p) return null
  const r = p.getBoundingClientRect()
  return [r.x + r.width / 2, r.y + r.height / 2]
}, [nodeId, kind])
const dragScreen = async (from, to) => {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  await page.mouse.move(from[0] + 30, from[1] + 15, { steps: 4 })
  await page.mouse.move(to[0], to[1], { steps: 12 })
  await page.waitForTimeout(200)
  await page.mouse.up()
  await page.waitForTimeout(400)
  await settle()
}
// pin anchor in graph units, matching ledger.anchorOf
const anchorOfPin = (nodeId, kind) => page.evaluate(([nodeId, kind]) => {
  const g = window.app.graph
  const node = g.getNodeById(Number(nodeId))
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    (x) => x.dataset.cablemanagementNode === nodeId && x.dataset.cablemanagementKind === kind
  )
  if (!el || !node) return null
  const T = window.LiteGraph?.NODE_TITLE_HEIGHT ?? 30
  return [node.pos[0] + el.offsetLeft + el.offsetWidth / 2, node.pos[1] - T + el.offsetTop + el.offsetHeight / 2]
}, [nodeId, kind])

// ---- (1) belt: drops onto floating reroutes ----------------------------------
// (1a) consumer input-drag onto a source-attached float
let ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CheckpointLoaderSimple', 60, 60)
  const C = mk('CheckpointSave', 1500, 500)
  const r = A.connectFloatingReroute([800, 300], A.outputs[0], undefined)
  return { A: String(A.id), C: String(C.id), rid: r.id }
})
await settle()
await dragScreen(await screenOfSlot(`${ids.C}-in-0`), await screenOfGraph(800, 300))
let st = await page.evaluate((i) => {
  const g = window.app.graph
  const C = g.getNodeById(Number(i.C))
  const link = C.inputs[0].link != null ? g._links.get(C.inputs[0].link) : null
  return { floating: g.floatingLinks.size, linked: !!link, parent: link?.parentId ?? null }
}, ids)
ok('input-drag onto source-attached float connects', st.linked && st.parent === ids.rid && st.floating === 0, JSON.stringify(st))

// (1b) source output-drag onto a target-attached float
ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const B = mk('CheckpointSave', 1500, 300)
  const D = mk('CheckpointLoaderSimple', 60, 500)
  const r = B.connectFloatingReroute([800, 300], B.inputs[0], undefined)
  return { B: String(B.id), D: String(D.id), rid: r.id }
})
await settle()
await dragScreen(await screenOfSlot(`${ids.D}-out-0`), await screenOfGraph(800, 300))
st = await page.evaluate((i) => {
  const g = window.app.graph
  const B = g.getNodeById(Number(i.B))
  const link = B.inputs[0].link != null ? g._links.get(B.inputs[0].link) : null
  return { floating: g.floatingLinks.size, linked: !!link, origin: link ? String(link.origin_id) : null, parent: link?.parentId ?? null }
}, ids)
ok('output-drag onto target-attached float connects', st.linked && st.origin === ids.D && st.parent === ids.rid && st.floating === 0, JSON.stringify(st))

// ---- (2b) widget passthrough float draws from the pin ------------------------
// Real end-to-end flow: pin drag released on empty canvas -> link-release
// CONTEXT MENU -> "Add Reroute". The plain-release action is context menu BY
// DECREE (Barney, 2026-08-06; the pack's suggested-next-node hooks it), so the
// suite pins the setting. Escape does NOT work as a park: the menu's
// cancelNextReset leaves the connector connecting until a choice resolves it.
await page.evaluate(async () => {
  await window.app.extensionManager?.setting?.set?.('Comfy.LinkRelease.Action', 'context menu')
})
ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CLIPTextEncode', 100, 300); A.title = 'A'
  const B = mk('CLIPTextEncode', 1400, 300); B.title = 'B'
  const w = A.widgets.find((w) => w.name === 'text')
  w.value = 'float me'
  return { A: String(A.id), B: String(B.id) }
})
await settle()
const park = async (nodeId, kind, at) => {
  const pin = await cablemanagementPin(nodeId, kind)
  const drop = await screenOfGraph(at[0], at[1])
  await page.mouse.move(pin[0], pin[1])
  await page.mouse.down()
  await page.mouse.move(pin[0] + 40, pin[1] + 20, { steps: 4 })
  await page.mouse.move(drop[0], drop[1], { steps: 12 })
  await page.waitForTimeout(200)
  await page.mouse.up()
  await page.waitForTimeout(500)
  return page.evaluate(() => {
    const items = [...document.querySelectorAll('.litecontextmenu .litemenu-entry')]
    const entry = items.find((el) => /reroute/i.test(el.textContent ?? ''))
    if (!entry) return null
    entry.click()
    const g = window.app.graph
    const float = [...g.floatingLinks.values()].at(-1)
    return float?.parentId ?? null
  })
}
let rid = await park(ids.A, 'widget', [800, 600])
await settle()
st = await page.evaluate((i) => {
  const g = window.app.graph
  const floats = [...g.floatingLinks.values()]
  const draw = floats.length ? window.__cablemanagementDraw?.get?.('f' + floats[0].id) : null
  return {
    floating: floats.length,
    prim: !!g.nodes.find((n) => n.type === 'PrimitiveNode'),
    floatfrom: g.extra?.cablemanagement_floatfrom ?? null,
    drawnStart: draw ? [draw[0], draw[1]] : null
  }
}, ids)
let anchor = await anchorOfPin(ids.A, 'widget')
ok('widget float parked with pin record', st.floating === 1 && st.prim && !!st.floatfrom?.[String(rid)], JSON.stringify(st.floatfrom))
ok('widget float draws from the widget pin', st.drawnStart && anchor &&
  Math.abs(st.drawnStart[0] - anchor[0]) < 1 && Math.abs(st.drawnStart[1] - anchor[1]) < 1,
  `drawn=${st.drawnStart} pin=${anchor}`)

// complete onto B's text input through the float (belt) -> provenance + value
const tgtKey = await page.evaluate((i) => {
  const B = window.app.graph.getNodeById(Number(i.B))
  return `${i.B}-in-${B.inputs.findIndex((s) => s.widget?.name === 'text')}`
}, ids)
await dragScreen(await screenOfSlot(tgtKey), await screenOfGraph(800, 600))
st = await page.evaluate(async (i) => {
  const g = window.app.graph
  const B = g.getNodeById(Number(i.B))
  const k = B.inputs.findIndex((s) => s.widget?.name === 'text')
  const link = B.inputs[k].link != null ? g._links.get(B.inputs[k].link) : null
  const p = await window.app.graphToPrompt()
  const draw = link ? window.__cablemanagementDraw?.get?.(link.id) : null
  return {
    floating: g.floatingLinks.size,
    linked: !!link,
    provenance: B.properties?.['cablemanagement.from']?.[String(k)] ?? null,
    drawnStart: draw ? [draw[0], draw[1]] : null,
    bText: p.output[i.B]?.inputs?.text
  }
}, ids)
anchor = await anchorOfPin(ids.A, 'widget')
ok('completion inherits pin provenance', st.linked && st.floating === 0 && st.provenance?.[0] === ids.A, JSON.stringify(st.provenance))
ok('completed link draws from the pin', st.drawnStart && Math.abs(st.drawnStart[0] - anchor[0]) < 1 && Math.abs(st.drawnStart[1] - anchor[1]) < 1, `drawn=${st.drawnStart} pin=${anchor}`)
ok('widget value reaches the prompt', st.bText === 'float me', JSON.stringify(st.bText))

// ---- (2a) input passthrough float draws from the pin -------------------------
ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A2 = mk('CheckpointLoaderSimple', 100, 100)
  const B2 = mk('CheckpointSave', 800, 100)
  const C2 = mk('CheckpointSave', 800, 600)
  A2.connect(0, B2, 0)
  return { A2: String(A2.id), B2: String(B2.id), C2: String(C2.id) }
})
await settle()
rid = await park(ids.B2, 'link', [500, 800])
await settle()
st = await page.evaluate((i) => {
  const g = window.app.graph
  const floats = [...g.floatingLinks.values()]
  const draw = floats.length ? window.__cablemanagementDraw?.get?.('f' + floats[0].id) : null
  const B2 = g.getNodeById(Number(i.B2))
  return {
    floating: floats.length,
    stillLinked: B2.inputs[0].link != null,
    floatfrom: g.extra?.cablemanagement_floatfrom ?? null,
    drawnStart: draw ? [draw[0], draw[1]] : null
  }
}, ids)
anchor = await anchorOfPin(ids.B2, 'link')
ok('input float parked, original link intact', st.floating === 1 && st.stillLinked && !!st.floatfrom?.[String(rid)], JSON.stringify(st.floatfrom))
ok('input float draws from the passthrough pin', st.drawnStart && anchor &&
  Math.abs(st.drawnStart[0] - anchor[0]) < 1 && Math.abs(st.drawnStart[1] - anchor[1]) < 1,
  `drawn=${st.drawnStart} pin=${anchor}`)

await dragScreen(await screenOfSlot(`${ids.C2}-in-0`), await screenOfGraph(500, 800))
st = await page.evaluate((i) => {
  const g = window.app.graph
  const C2 = g.getNodeById(Number(i.C2))
  const link = C2.inputs[0].link != null ? g._links.get(C2.inputs[0].link) : null
  const draw = link ? window.__cablemanagementDraw?.get?.(link.id) : null
  return {
    floating: g.floatingLinks.size,
    linked: !!link,
    origin: link ? String(link.origin_id) : null,
    provenance: C2.properties?.['cablemanagement.from']?.['0'] ?? null,
    drawnStart: draw ? [draw[0], draw[1]] : null
  }
}, ids)
anchor = await anchorOfPin(ids.B2, 'link')
ok('input float completes from the true datasource', st.linked && st.origin === ids.A2 && st.floating === 0, JSON.stringify(st))
ok('completed link inherits the pin provenance', st.provenance?.[0] === ids.B2, JSON.stringify(st.provenance))
ok('completed link draws from the pin', st.drawnStart && Math.abs(st.drawnStart[0] - anchor[0]) < 1 && Math.abs(st.drawnStart[1] - anchor[1]) < 1, `drawn=${st.drawnStart} pin=${anchor}`)

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
