// Gate pins are one side of a node: the per-side lane allocation (stub-rank)
// applies to teeth. Four wires from a loader above-left feed the in-gate: all
// up-benders, so topmost tooth bends closest (stubs 24/29/34/39 by row) and the
// pin-side segments never cross.
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

const out = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  const P = window.__cablemanagementPathing, C = window.__cablemanagementCombs
  const settle = async () => {
    for (let i = 0; i < 8; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 200)) }
  }
  g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  app.canvas.links_render_mode = P.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('SuperEfficientLoader', 100, 80)
  const B = mk('RemoteController', 1500, 300)
  const names = ['model', 'clip', 'vae', 'checkpoint_name']
  for (let s = 0; s < 4; s++) {
    const k = B.inputs.findIndex((i) => i.name === names[s])
    if (k >= 0) A.connect(s, B, k)
  }
  const ids = [...g._links.values()].map((l) => l.id)
  const combId = C.create(ids[0], ids[1], 700, 350)
  C.move(combId, 'out', 1100, 350)
  C.add(combId, ids[2])
  C.add(combId, ids[3])
  await settle()

  const rec = g.extra.cablemanagement_combs[0]
  const routes = P.routes()
  const near = (p, q) => Math.abs(p[0] - q[0]) < 2 && Math.abs(p[1] - q[1]) < 2
  const entries = []
  for (const r of routes) {
    if (r.key.includes('|X')) continue
    rec.lanes.forEach((l, lane) => {
      const tin = g.reroutes.get(l.in)
      const last = r.pts[r.pts.length - 1]
      if (tin && near(last, tin.pos)) {
        entries.push({ lane, stub: last[0] - r.pts[r.pts.length - 2][0], pts: r.pts })
      }
    })
  }
  entries.sort((a, b) => a.lane - b.lane)
  // crossings among the pin-side segments
  const H = [], V = []
  entries.forEach((e2) => {
    for (let k = 0; k < e2.pts.length - 1; k++) {
      const a = e2.pts[k], c = e2.pts[k + 1]
      if (Math.abs(a[0] - c[0]) < 0.1) V.push({ s: e2.lane, x: a[0], lo: Math.min(a[1], c[1]), hi: Math.max(a[1], c[1]) })
      else H.push({ s: e2.lane, y: a[1], lo: Math.min(a[0], c[0]), hi: Math.max(a[0], c[0]) })
    }
  })
  let n = 0
  for (const h of H) for (const v of V) {
    if (h.s === v.s) continue
    if (v.x > h.lo + 1 && v.x < h.hi - 1 && h.y > v.lo + 1 && h.y < v.hi - 1) n++
  }
  return { stubs: entries.map((e2) => Math.round(e2.stub)), crossings: n, count: entries.length }
})

ok('four pin entries found', out.count === 4, `got ${out.count}`)
ok('stub-rank on gate pins', JSON.stringify(out.stubs) === JSON.stringify([24, 29, 34, 39]), JSON.stringify(out.stubs))
ok('no crossings at the pin side', out.crossings === 0, `got ${out.crossings}`)
console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
