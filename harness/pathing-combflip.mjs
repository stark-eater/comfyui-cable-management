// Flip enforcement: a gate's faces bind REGARDLESS of layout convenience. The
// trivial-straight router shortcut used to bypass stub directions whenever a
// clear corridor existed, so flips "did nothing" unless geometry forced a wrap.
// (1) flipped in-gate: pin wires enter the RIGHT face (arrive traveling left),
// ribbon leaves the LEFT face (wraps past it); (2) flipped out-gate: pin wires
// exit the LEFT face (depart traveling left), ribbon enters the RIGHT face.
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
    for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 200)) }
  }
  g.clear()
  app.canvas.links_render_mode = P.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const s1 = mk('CheckpointLoaderSimple', 100, 100)
  const t1 = mk('CheckpointSave', 1500, 120)
  const s2 = mk('CheckpointLoaderSimple', 100, 400)
  const t2 = mk('CheckpointSave', 1500, 420)
  s1.connect(0, t1, 0); s2.connect(0, t2, 0)
  const [l1, l2] = [...g._links.values()].map((l) => l.id)
  const combId = C.create(l1, l2, 700, 300)
  C.move(combId, 'out', 1100, 300)
  await settle()

  const measure = () => {
    const rec = g.extra.cablemanagement_combs[0]
    const routes = P.routes()
    const near = (p, q) => Math.abs(p[0] - q[0]) < 2 && Math.abs(p[1] - q[1]) < 2
    const res = { crossMinX: Infinity, crossMaxX: -Infinity, pinArrive: [], pinDepart: [] }
    for (const r of routes) {
      if (r.key.includes('|X')) {
        for (const p of r.pts) {
          if (p[0] < res.crossMinX) res.crossMinX = p[0]
          if (p[0] > res.crossMaxX) res.crossMaxX = p[0]
        }
        continue
      }
      for (const l of rec.lanes) {
        const tin = g.reroutes.get(l.in), tout = g.reroutes.get(l.out)
        const last = r.pts[r.pts.length - 1], first = r.pts[0]
        if (tin && near(last, tin.pos)) {
          res.pinArrive.push(Math.sign(last[0] - r.pts[r.pts.length - 2][0]))
        }
        if (tout && near(first, tout.pos)) {
          res.pinDepart.push(Math.sign(r.pts[1][0] - first[0]))
        }
      }
    }
    return { ...res, inX: rec.in.pos[0], outX: rec.out.pos[0] }
  }

  const combRef = () => g.extra.cablemanagement_combs[0].id
  // (1) flip the in-gate
  C.flip(combRef(), 'in')
  await settle()
  const flippedIn = measure()
  C.flip(combRef(), 'in') // restore
  await settle()
  // (2) flip the out-gate
  C.flip(combRef(), 'out')
  await settle()
  const flippedOut = measure()
  return { flippedIn, flippedOut }
})

const fi = out.flippedIn
ok('flipped in-gate: pins enter from the right', fi.pinArrive.length === 2 && fi.pinArrive.every((d) => d === -1), JSON.stringify(fi.pinArrive))
ok('flipped in-gate: ribbon wraps past the left face', fi.crossMinX < fi.inX - 10, `minX=${fi.crossMinX.toFixed(0)} gateX=${fi.inX}`)
const fo = out.flippedOut
ok('flipped out-gate: pins exit to the left', fo.pinDepart.length === 2 && fo.pinDepart.every((d) => d === -1), JSON.stringify(fo.pinDepart))
ok('flipped out-gate: ribbon wraps past the right face', fo.crossMaxX > fo.outX + 24 + 10, `maxX=${fo.crossMaxX.toFixed(0)} face=${fo.outX + 24}`)
console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
