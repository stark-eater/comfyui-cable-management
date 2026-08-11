// Spectral check: capture EVERY browser console emission (log/info/warn/error)
// plus uncaught page errors across a representative session, and attribute each
// line to us / core / other extensions. Observation instrument: always exits 0
// and prints the spectrum; the battery-suite version of this would assert that
// the OURS rows contain zero errors/warnings once a baseline is agreed.
import { chromium } from 'playwright'

const URL = process.env.COMFY_URL ?? 'http://127.0.0.1:8187'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1920, height: 1080 } })

const events = []
page.on('console', (m) => {
  const loc = m.location()
  events.push({ kind: m.type(), text: m.text().slice(0, 300), url: loc.url ?? '', phase: phase })
})
page.on('pageerror', (e) => {
  events.push({ kind: 'pageerror', text: String(e.stack ?? e).slice(0, 600), url: '', phase: phase })
})
let phase = 'boot'

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.LiteGraph, null, { timeout: 120_000 })
await page.waitForTimeout(3500)

phase = 'scene'
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph
  g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [80, 120]; g.add(CK)
  const A = L.createNode('CLIPTextEncode'); A.pos = [520, 120]; A.title = 'A'; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos = [520, 420]; B.title = 'B'; g.add(B)
  const ci = (n) => n.inputs.findIndex((s) => s.type === 'CLIP')
  CK.connect(1, A, ci(A)); CK.connect(1, B, ci(B))
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 1800))
  return { CK: CK.id, A: A.id, B: B.id }
})

phase = 'comb'
await page.evaluate(async ({ ids }) => {
  const g = window.app.graph
  const links = [...g._links.values()].filter((l) => l.origin_id === ids.CK)
  // stack two reroutes at the same spot -- the comb machinery enrolls them
  for (const l of links) g.createReroute([340, 260], l)
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 1200))
}, { ids })

phase = 'gestures'
// drag node A around (route recompute), then pull from a pin and abort
const pin = await page.evaluate(({ ids }) => {
  const p = [...document.querySelectorAll('.cablemanagement-pin')].find(
    (x) => x.dataset.cablemanagementNode === String(ids.A))
  if (!p) return null
  const r = p.getBoundingClientRect()
  return [r.x + r.width / 2, r.y + r.height / 2]
}, { ids })
const node = await page.evaluate(({ ids }) => {
  const n = window.app.graph.getNodeById(ids.A)
  const [cx, cy] = window.app.canvas.convertOffsetToCanvas
    ? window.app.canvas.convertOffsetToCanvas([n.pos[0] + 60, n.pos[1] - 12])
    : [n.pos[0] + 60, n.pos[1] - 12]
  return [cx, cy]
}, { ids })
await page.mouse.move(...node); await page.mouse.down()
await page.mouse.move(node[0] + 120, node[1] + 60, { steps: 8 })
await page.mouse.up(); await page.waitForTimeout(700)
if (pin) {
  await page.mouse.move(...pin); await page.mouse.down()
  await page.mouse.move(pin[0] + 90, pin[1] + 200, { steps: 8 })
  await page.mouse.up(); await page.waitForTimeout(500)
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)
}

phase = 'undo-redo'
await page.keyboard.press('Control+z'); await page.waitForTimeout(600)
await page.keyboard.press('Control+y'); await page.waitForTimeout(600)

phase = 'serialize'
await page.evaluate(async () => {
  const g = window.app.graph
  const s = g.serialize()
  g.configure(JSON.parse(JSON.stringify(s)))
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 1500))
})

phase = 'settle'
await page.waitForTimeout(2000)
// Read the session's actual node mode before closing: the legacy boot canary
// ("node modifications idle") is EXPECTED exactly when Vue nodes are off, and
// stays a failure if it ever fires in a Vue session.
const legacySession = await page.evaluate(
  () => !document.querySelector('.lg-node') && !window.LiteGraph?.vueNodesMode)
await b.close()

// ---- attribution & report ----
const OURS = /extensions\/(wgimco|[^/]*cable[^/]*)\/|cablemanagement/i
const src = (e) => (OURS.test(e.url) || OURS.test(e.text)) ? 'OURS'
  : /extensions\//.test(e.url + e.text) ? 'other-ext' : 'core'

const tally = {}
for (const e of events) {
  const k = `${src(e)} ${e.kind}`
  tally[k] = (tally[k] ?? 0) + 1
}
console.log('=== spectrum ===')
for (const [k, n] of Object.entries(tally).sort()) console.log(`${String(n).padStart(4)}  ${k}`)

console.log('\n=== OURS, every line ===')
for (const e of events.filter((e) => src(e) === 'OURS'))
  console.log(`[${e.phase}] ${e.kind}: ${e.text}\n      @ ${e.url}`)

console.log('\n=== non-OURS warnings/errors (unique, first 20) ===')
const seen = new Set()
for (const e of events.filter((e) => src(e) !== 'OURS' && ['warning', 'error', 'pageerror'].includes(e.kind))) {
  const key = e.text.slice(0, 120)
  if (seen.has(key)) continue
  seen.add(key)
  if (seen.size > 20) break
  console.log(`[${e.phase}] ${e.kind}: ${e.text.slice(0, 200)}\n      @ ${e.url}`)
}
console.log(`\ntotal events: ${events.length}`)

// battery mode: any warning/error/pageerror attributed to us fails the suite.
// Exception: the deliberate legacy boot canary, expected iff the session is legacy.
const expected = (e) =>
  legacySession && e.kind === 'warning' && /node modifications idle/.test(e.text)
const oursBad = events.filter(
  (e) => src(e) === 'OURS' && ['warning', 'error', 'pageerror'].includes(e.kind) && !expected(e))
console.log(oursBad.length === 0 ? 'PASS' : `FAIL (${oursBad.length} emissions of ours)`)
process.exit(oursBad.length === 0 ? 0 : 1)
