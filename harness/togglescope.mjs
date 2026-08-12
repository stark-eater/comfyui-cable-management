// The node-features toggle is for NODES. Routing and ribbons must not notice it.
//
// Regression guard for the "off killed PCB mode and combs too" bug: the flag had
// leaked into pathing.js and combclipboard.js, so the one setting whose own tooltip
// says "PCB routing and ribbons work without it" took both away.
//
// Everything below runs with cablemanagement.enabled OFF: PCB still routes plain
// links, a comb still mints/draws/hit-tests, comb records still survive a
// copy/paste -- while the node features really are gone.
//
//   node togglescope.mjs
import { chromium } from 'playwright'

const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}

await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(
  () => window.app?.graph && window.__cablemanagementPathing?.state?.patched && window.__cablemanagementCombs,
  null,
  { timeout: 120_000 }
)
await page.evaluate(() => window.__cablemanagement?.debugView?.(false))
await page.waitForTimeout(3000)

// The whole point: node features OFF for every assert that follows.
await page.evaluate(async () => {
  await window.app.extensionManager.setting.set('cablemanagement.enabled', false)
})
await page.waitForTimeout(1000)

const out = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  const P = window.__cablemanagementPathing, C = window.__cablemanagementCombs
  const settle = async () => {
    for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 200)) }
  }
  const mk = (type, x, y) => { const n = L.createNode(type); n.pos = [x, y]; g.add(n); return n }

  g.clear(); { const d = app.canvas.ds; d.scale = 1; d.offset = [20, 20] }
  app.canvas.links_render_mode = P.PCB()
  const r = {}

  const s1 = mk('CheckpointLoaderSimple', 100, 100)
  const t1 = mk('CheckpointSave', 1500, 120)
  const s2 = mk('CheckpointLoaderSimple', 100, 400)
  const t2 = mk('CheckpointSave', 1500, 420)
  s1.connect(0, t1, 0); s2.connect(0, t2, 0)
  const [l1, l2] = [...g._links.values()].map((l) => l.id)
  await settle()

  // (1) plain-link routing under PCB mode
  r.routes = P.routes().length

  // (2) ribbons: create, spread, draw, hit-test
  const combId = C.create(l1, l2, 700, 300)
  C.move(combId, 'out', 1100, 300)
  await settle()
  const combs = await import('./extensions/wgimco/pathing/combs.js')
  r.record = (g.extra?.cablemanagement_combs ?? []).length
  r.lanes = C.list()[0]?.lanes?.length ?? 0
  r.gateRects = combs.gateRects(g).length
  const gr = combs.gateRects(g)[0]
  r.hitTest = gr ? !!combs.combAt(g, gr.x + gr.w / 2, gr.y + gr.h / 2) : false
  r.combRoutes = P.routes().filter((x) => x.key.includes('|X')).length

  // (3) comb records survive the clipboard
  const ser = app.canvas._serializeItems(new Set(g.nodes))
  r.clipboardCarriesComb = !!ser?.cablemanagement_combs?.length

  // (4) the toggle still does its OWN job
  r.pins = document.querySelectorAll('.cablemanagement-pin').length
  r.layoutClass = document.body.classList.contains('cablemanagement-layout')
  return r
})

ok('PCB routes plain links with the toggle off', out.routes > 0, `${out.routes} routes`)
ok('comb mints and lays out', out.record === 1 && out.lanes === 2, JSON.stringify({ record: out.record, lanes: out.lanes }))
ok('gates draw and hit-test', out.gateRects === 2 && out.hitTest, JSON.stringify({ gateRects: out.gateRects, hitTest: out.hitTest }))
ok('ribbon crossings route', out.combRoutes > 0, `${out.combRoutes} crossing routes`)
ok('comb survives the clipboard', out.clipboardCarriesComb)
ok('node features really are off', out.pins === 0 && !out.layoutClass, JSON.stringify({ pins: out.pins, layout: out.layoutClass }))

// Leave the setting as found.
await page.evaluate(async () => {
  await window.app.extensionManager.setting.set('cablemanagement.enabled', true)
})
await page.waitForTimeout(700)

console.log('page errors:', errs.length)
errs.slice(0, 6).forEach((e) => console.log('  ! ' + e.slice(0, 150)))
console.log(pass && !errs.length ? '\nPASS' : '\nFAIL')
await b.close()
