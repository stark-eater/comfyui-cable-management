// Floating-ribbon pop regression (QA 2f): two floats pulled from one node's
// passthrough pins, combed into a floating ribbon, then an unrelated edit.
// The floats must draw from their PINS at every stage -- combing migrates the
// floatfrom records onto the minted teeth instead of orphaning them (absorb()
// removes the original reroutes the records were keyed by).
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 2100, height: 1100 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagement && window.__cablemanagementCombs, null, { timeout: 120_000 })
await page.waitForTimeout(2600)

const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const A = L.createNode('EmptyLatentImage'); A.pos = [150, 120]; A.title = 'A'; g.add(A)
  const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [80, 420]; CK.title = 'CK'; g.add(CK)
  const B = L.createNode('KSampler'); B.pos = [700, 200]; B.title = 'B'; g.add(B)
  const A2 = L.createNode('EmptyLatentImage'); A2.pos = [150, 800]; A2.title = 'A2'; g.add(A2)
  const B2 = L.createNode('KSampler'); B2.pos = [700, 780]; B2.title = 'B2'; g.add(B2)
  const iLat = B.inputs.findIndex((s) => s.name === 'latent_image')
  const iMod = B.inputs.findIndex((s) => s.name === 'model')
  A.connect(0, B, iLat)
  CK.connect(0, B, iMod)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1500))
  // Two floats "pulled from B's pins": floating reroute from each true origin
  // plus the floatfrom record drag.js would write for a real pin gesture.
  const r1 = A.connectFloatingReroute([1250, 300], A.outputs[0])
  const r2 = CK.connectFloatingReroute([1250, 500], CK.outputs[0])
  const ff = ((g.extra ??= {}).cablemanagement_floatfrom ??= {})
  ff[String(r1.id)] = [String(B.id), iLat]
  ff[String(r2.id)] = [String(B.id), iMod]
  window.__cablemanagement.routesPass() // invalidate, as the real gesture's wrap does
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 900))
  return { B: String(B.id), A2: String(A2.id), B2: String(B2.id), iLat, iMod,
    r1: r1.id, r2: r2.id, r1pos: [...r1.pos], r2pos: [...r2.pos] }
})

// Each float's drawn start must sit on B's pin for its input (within 4 units).
const floatsOnPins = () => page.evaluate(async ({ B, iLat, iMod }) => {
  const g = window.app.graph, L = window.LiteGraph
  window.__cablemanagementDraw = new Map(); window.__cablemanagementCapture = true
  for (let i = 0; i < 4; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
  window.__cablemanagementCapture = false
  const TITLE = L?.NODE_TITLE_HEIGHT ?? 30
  const node = g.getNodeById(Number(B))
  const pin = (idx) => {
    const el = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${B}"][data-cablemanagement-index="${idx}"]`)
    return el ? [node.pos[0] + el.offsetLeft + el.offsetWidth / 2, node.pos[1] - TITLE + el.offsetTop + el.offsetHeight / 2] : null
  }
  const out = []
  for (const f of g.floatingLinks?.values?.() ?? []) {
    const d = window.__cablemanagementDraw.get(f.id)
    out.push({ id: f.id, draw: d ? [Math.round(d[0]), Math.round(d[1])] : null })
  }
  const pins = { [iLat]: pin(iLat), [iMod]: pin(iMod) }
  const near = (d, p) => d && p && Math.hypot(d[0] - p[0], d[1] - p[1]) < 4
  const onPins = out.every((f) => near(f.draw, pins[iLat]) || near(f.draw, pins[iMod]))
  return { onPins, floats: out.length, ffKeys: Object.keys(g.extra?.cablemanagement_floatfrom ?? {}) }
}, { B: ids.B, iLat: ids.iLat, iMod: ids.iMod })

const s0 = await floatsOnPins()
ok('pre-comb: both floats draw from B\'s pins', s0.onPins && s0.floats === 2, JSON.stringify(s0))

// The comb gesture: drag reroute r1 onto r2 -> floating ribbon.
const scr = await page.evaluate(({ r1pos, r2pos }) => {
  const ds = window.app.canvas.ds
  const view = window.app.canvas.canvas.getBoundingClientRect()
  const s = (p) => [view.left + (p[0] + ds.offset[0]) * ds.scale, view.top + (p[1] + ds.offset[1]) * ds.scale]
  return { from: s(r1pos), to: s(r2pos) }
}, ids)
await page.mouse.move(...scr.from); await page.mouse.down()
await page.mouse.move(scr.to[0], scr.to[1], { steps: 12 }); await page.waitForTimeout(300)
await page.mouse.up(); await page.waitForTimeout(1200)

const s1 = await floatsOnPins()
const combed = await page.evaluate(() => (window.app.graph.extra?.cablemanagement_combs ?? []).length)
ok('comb: floating ribbon created', combed === 1)
ok('comb: floats STILL draw from B\'s pins (records migrated to teeth)',
  s1.onPins && s1.floats === 2 && !s1.ffKeys.includes(String(ids.r1)) && !s1.ffKeys.includes(String(ids.r2)),
  JSON.stringify(s1))

// The unrelated modification that used to pop them to their true origins.
await page.evaluate(({ A2, B2 }) => {
  const g = window.app.graph
  const B2n = g.getNodeById(Number(B2))
  g.getNodeById(Number(A2)).connect(0, B2n, B2n.inputs.findIndex((s) => s.name === 'latent_image'))
  window.dispatchEvent(new CustomEvent('cablemanagement:resync'))
}, ids)
await page.waitForTimeout(1200)
const s2 = await floatsOnPins()
ok('after edit: floats hold their pins (no pop to true origin)', s2.onPins && s2.floats === 2, JSON.stringify(s2))

console.log('page errors:', errs.length ? errs.slice(0, 4) : 'none')
if (errs.length) pass = false
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
