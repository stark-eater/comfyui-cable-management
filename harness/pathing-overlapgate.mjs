// Rules from the 2026-08-05 QA round ("decollides lines that never overlap"):
//  A. near-collinear runs with DISJOINT longitudinal spans are never spread -- proximity
//     on a lane alone is not a collision
//  C. a deliberately aligned corridor that is tight (inside a neighbour's 16px clearance
//     but over no real node) routes STRAIGHT instead of detouring around the neighbour
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagementPathing?.state?.patched, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

const out = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  const P = window.__cablemanagementPathing
  // Ghost entries (routes drawn once from default slot positions before the DOM
  // measure lands) die only after the liveness grace window -- burn enough frames.
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      g.setDirtyCanvas(true, true)
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  const mk = (type, x, y) => { const n = L.createNode(type); n.pos = [x, y]; g.add(n); return n }

  // Scene A: two identical stepped links far apart in x. Their long horizontal runs land
  // on the SAME lane y (same node types at the same y) with disjoint x spans.
  g.clear()
  app.canvas.links_render_mode = P.PCB()
  const S1 = mk('Reroute', 100, 200), T1 = mk('Reroute', 420, 330)
  const S2 = mk('Reroute', 1000, 200), T2 = mk('Reroute', 1320, 330)
  S1.connect(0, T1, 0)
  S2.connect(0, T2, 0)
  await settle()
  const a = P.routes().map((r) => ({
    moved: JSON.stringify(r.pts) !== JSON.stringify(r.raw),
    pts: r.pts
  }))

  // Scene C: near-aligned pins (exact alignment is impossible -- node positions snap to
  // the grid and in/out pin rows sit a couple px apart even at identical pos), with a
  // crowding node whose REAL top edge lands inside the corridor's 16px clearance but
  // outside its 4px hard margin. Wanted: a near-straight route inside the pin band with
  // at most one tiny end-jog -- no excursion around the crowder. Two phases: measure
  // the corridor first, then rebuild with the crowder at final coordinates (post-hoc
  // pos writes do not reliably reach the DOM).
  g.clear()
  const mA = mk('Reroute', 100, 300), mB = mk('Reroute', 900, 300)
  const mC = mk('CLIPTextEncode', 420, 700)
  mA.connect(0, mB, 0)
  await settle()
  const m0 = P.routes()[0]
  let cPts = null, band = null, fixtureOk = false
  if (m0) {
    const startY = m0.raw[0][1], endY = m0.raw[m0.raw.length - 1][1]
    const clipBr = mC.boundingRect ?? [mC.pos[0], mC.pos[1], mC.size[0], mC.size[1]]
    const titleDelta = mC.pos[1] - clipBr[1] // how far the real box starts above pos
    band = [Math.min(startY, endY), Math.max(startY, endY)]

    g.clear()
    const A = mk('Reroute', 100, 300), B = mk('Reroute', 900, 300)
    const C = mk('CLIPTextEncode', 420, band[1] + 8 + titleDelta)
    A.connect(0, B, 0)
    await settle()
    // The grid snap may have moved the crowder; the scene only counts when its real top
    // edge sits inside the corridor's clearance ring.
    const br = C.boundingRect ?? [C.pos[0], C.pos[1], C.size[0], C.size[1]]
    const gap = br[1] - band[1]
    fixtureOk = gap > 4.5 && gap < 15.5
    const rc = P.routes().find((r) => Math.abs(r.raw[0][1] - startY) < 1)
    cPts = rc ? rc.pts : 'trivial' // null route = core renders it straight, equally fine
  }

  return { a, cPts, band, fixtureOk }
})

let pass = true
const movedA = out.a.filter((r) => r.moved).length
if (out.a.length !== 2 || movedA > 0) pass = false
console.log(`A: routes=${out.a.length} spread=${movedA} (want 2 routes, 0 spread)`)

let cOk = false
if (out.cPts === 'trivial') cOk = true
else if (Array.isArray(out.cPts)) {
  const ys = out.cPts.map((p) => p[1])
  const inBand = Math.min(...ys) > out.band[0] - 1 && Math.max(...ys) < out.band[1] + 1
  cOk = inBand && out.cPts.length <= 4
}
if (!out.fixtureOk || !cOk) pass = false
console.log(`C: fixture=${out.fixtureOk} route=${out.cPts === 'trivial' ? 'trivial straight' : JSON.stringify(out.cPts)}`)
console.log(`   (want: stays inside pin band [${out.band?.map((v) => v.toFixed(1))}], <=4 points)`)

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
