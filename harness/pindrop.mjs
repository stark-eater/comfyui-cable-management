// Passthrough pins as DROP TARGETS (Barney's QA: "pin not receiving links").
// (A) consumer input-drag onto a WIDGET pin: primitive materialised on demand,
//     consumer fed from it, provenance recorded, wire draws from the pin, value
//     reaches the prompt; (B) consumer input-drag onto a LINK pin: consumer fed
//     from the true upstream origin, provenance + pin draw; (C) source
//     output-drag onto a link pin still rewires the host's input (core's
//     node-body drop, untouched). Two seams feed this: window-capture pointerup
//     for Vue drags (node-DOM drops never reach the link connector), lc wraps
//     for legacy -- __cablemanagementPinDone latch prevents double-connects.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagementPathing?.state?.patched, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}
const settle = () => page.evaluate(async () => {
  const g = window.app.graph
  window.__cablemanagementCapture = true
  for (let i = 0; i < 5; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
})
const pinPos = (nodeId, kind, index) => page.evaluate(([nodeId, kind, index]) => {
  const p = [...document.querySelectorAll('.cablemanagement-pin')].find(
    (x) => x.dataset.cablemanagementNode === nodeId && x.dataset.cablemanagementKind === kind &&
      (index == null || x.dataset.cablemanagementIndex === String(index))
  )
  if (!p) return null
  const r = p.getBoundingClientRect()
  return [r.x + r.width / 2, r.y + r.height / 2]
}, [nodeId, kind, index ?? null])
const slotPos = (key) => page.evaluate((key) => {
  const d = document.querySelector(`[data-slot-key="${key}"]`)
  if (!d) return null
  const r = d.getBoundingClientRect()
  return [r.x + r.width / 2, r.y + r.height / 2]
}, key)
const anchorOfPin = (nodeId, kind, index) => page.evaluate(([nodeId, kind, index]) => {
  const g = window.app.graph
  const node = g.getNodeById(Number(nodeId))
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    (x) => x.dataset.cablemanagementNode === nodeId && x.dataset.cablemanagementKind === kind &&
      (index == null || x.dataset.cablemanagementIndex === String(index))
  )
  if (!el || !node) return null
  const T = window.LiteGraph?.NODE_TITLE_HEIGHT ?? 30
  return [node.pos[0] + el.offsetLeft + el.offsetWidth / 2, node.pos[1] - T + el.offsetTop + el.offsetHeight / 2]
}, [nodeId, kind, index ?? null])
const drag = async (from, to) => {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  await page.mouse.move(from[0] + 30, from[1] + 15, { steps: 4 })
  await page.mouse.move(to[0], to[1], { steps: 12 })
  await page.waitForTimeout(250)
  await page.mouse.up()
  await page.waitForTimeout(400)
  const menu = await page.evaluate(() => !!document.querySelector('.litecontextmenu'))
  if (menu) { await page.mouse.click(200, 900); await page.waitForTimeout(300) }
  await settle()
}

// (A) consumer text input of C dropped on A's widget pin
let ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CLIPTextEncode', 100, 300)
  const C = mk('CLIPTextEncode', 1300, 300)
  A.widgets.find((w) => w.name === 'text').value = 'pin drop A'
  const k = C.inputs.findIndex((s) => s.widget?.name === 'text')
  return { A: String(A.id), C: String(C.id), k }
})
await settle()
await drag(await slotPos(`${ids.C}-in-${ids.k}`), await pinPos(ids.A, 'widget'))
let st = await page.evaluate(async (i) => {
  const g = window.app.graph
  const C = g.getNodeById(Number(i.C))
  const link = C.inputs[i.k].link != null ? g._links.get(C.inputs[i.k].link) : null
  const prim = g.nodes.find((n) => n.type === 'PrimitiveNode')
  const p = await window.app.graphToPrompt()
  const draw = link ? window.__cablemanagementDraw?.get?.(link.id) : null
  return {
    linked: !!link,
    fromPrim: link && prim && String(link.origin_id) === String(prim.id),
    provenance: C.properties?.['cablemanagement.from']?.[String(i.k)] ?? null,
    drawnStart: draw ? [draw[0], draw[1]] : null,
    cText: p.output[i.C]?.inputs?.text
  }
}, ids)
let anchor = await anchorOfPin(ids.A, 'widget')
ok('widget pin receives the consumer', st.linked && st.fromPrim, JSON.stringify(st))
ok('provenance points at the pin', st.provenance?.[0] === ids.A, JSON.stringify(st.provenance))
ok('wire draws from the widget pin', st.drawnStart && Math.abs(st.drawnStart[0] - anchor[0]) < 1 && Math.abs(st.drawnStart[1] - anchor[1]) < 1, `drawn=${st.drawnStart} pin=${anchor}`)
ok('widget value reaches the prompt', st.cText === 'pin drop A', JSON.stringify(st.cText))

// (B) consumer model input of C2 dropped on B2's link pin (B2 fed by A2)
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
await drag(await slotPos(`${ids.C2}-in-0`), await pinPos(ids.B2, 'link', 0))
st = await page.evaluate((i) => {
  const g = window.app.graph
  const C2 = g.getNodeById(Number(i.C2))
  const link = C2.inputs[0].link != null ? g._links.get(C2.inputs[0].link) : null
  const draw = link ? window.__cablemanagementDraw?.get?.(link.id) : null
  return {
    linked: !!link,
    origin: link ? String(link.origin_id) : null,
    provenance: C2.properties?.['cablemanagement.from']?.['0'] ?? null,
    drawnStart: draw ? [draw[0], draw[1]] : null
  }
}, ids)
anchor = await anchorOfPin(ids.B2, 'link', 0)
ok('link pin feeds from the true origin', st.linked && st.origin === ids.A2, JSON.stringify(st))
ok('link-pin provenance points at the pin', st.provenance?.[0] === ids.B2, JSON.stringify(st.provenance))
ok('wire draws from the link pin', st.drawnStart && Math.abs(st.drawnStart[0] - anchor[0]) < 1 && Math.abs(st.drawnStart[1] - anchor[1]) < 1, `drawn=${st.drawnStart} pin=${anchor}`)

// (C) source output-drag onto the link pin rewires the host's input (core path)
const dId = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph
  const D = L.createNode('CheckpointLoaderSimple'); D.pos = [100, 600]; g.add(D)
  return String(D.id)
})
await settle()
await drag(await slotPos(`${dId}-out-0`), await pinPos(ids.B2, 'link', 0))
st = await page.evaluate((i) => {
  const g = window.app.graph
  const B2 = g.getNodeById(Number(i.B2))
  const link = B2.inputs[0].link != null ? g._links.get(B2.inputs[0].link) : null
  return { origin: link ? String(link.origin_id) : null }
}, ids)
ok('source drop still rewires the host input', st.origin === dId, JSON.stringify(st))

// (D) the thief: host has an UNOCCUPIED matching-type output. The node-hover
// implied connection used to win the drop and wire the consumer to that output
// instead of the pin (measured: it replaced the pin link -- an input holds one
// link). KSampler: latent_image fed by EmptyLatentImage, LATENT output free;
// VAEDecode's samples dropped on the latent pin must feed from the TRUE ORIGIN.
ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const E = mk('EmptyLatentImage', 100, 100)
  const K = mk('KSampler', 700, 100)
  const V = mk('VAEDecode', 700, 700)
  const kIdx = K.inputs.findIndex((s) => s.name === 'latent_image')
  E.connect(0, K, kIdx)
  return { E: String(E.id), K: String(K.id), V: String(V.id), kIdx }
})
await settle()
// manual drag: hold over the pin mid-drag to assert the preview magnet
const dFrom = await slotPos(`${ids.V}-in-0`)
const dTo = await pinPos(ids.K, 'link', ids.kIdx)
await page.mouse.move(dFrom[0], dFrom[1])
await page.mouse.down()
await page.mouse.move(dFrom[0] + 30, dFrom[1] + 15, { steps: 4 })
await page.mouse.move(dTo[0], dTo[1], { steps: 12 })
await page.waitForTimeout(300)
const preview = await page.evaluate(([i, kIdx]) => {
  const g = window.app.graph
  const K = g.getNodeById(Number(i.K))
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    (x) => x.dataset.cablemanagementNode === i.K && x.dataset.cablemanagementKind === 'link' && x.dataset.cablemanagementIndex === String(kIdx)
  )
  const T = window.LiteGraph?.NODE_TITLE_HEIGHT ?? 30
  const anchor = el ? [K.pos[0] + el.offsetLeft + el.offsetWidth / 2, K.pos[1] - T + el.offsetTop + el.offsetHeight / 2] : null
  return { snap: window.app.canvas.linkConnector.state.snapLinksPos ?? null, anchor }
}, [ids, ids.kIdx])
ok('preview magnetises to the pin mid-drag', preview.snap && preview.anchor &&
  Math.abs(preview.snap[0] - preview.anchor[0]) < 1 && Math.abs(preview.snap[1] - preview.anchor[1]) < 1,
  `snap=${preview.snap} pin=${preview.anchor}`)
await page.mouse.up()
await page.waitForTimeout(400)
await settle()
st = await page.evaluate((i) => {
  const g = window.app.graph
  const V = g.getNodeById(Number(i.V))
  const link = V.inputs[0].link != null ? g._links.get(V.inputs[0].link) : null
  return {
    linked: !!link,
    origin: link ? String(link.origin_id) : null,
    provenance: V.properties?.['cablemanagement.from']?.['0'] ?? null
  }
}, ids)
ok('pin beats the implied-connection thief', st.linked && st.origin === ids.E, JSON.stringify(st))
ok('thief-case provenance points at the pin', st.provenance?.[0] === ids.K, JSON.stringify(st.provenance))

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
