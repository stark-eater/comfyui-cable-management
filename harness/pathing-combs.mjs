// Comb PoC: programmatic API only. Asserts (1) enrollment builds source->in->out->
// target chains and the comb record lands in graph.extra; (2) the ribbon routes at
// 5px pitch (3px stroke + 2px gap) with insertion order preserved; (3) adding a lane grows the
// gates and keeps the pitch; (4) the template routes AROUND an obstacle dropped on
// the corridor; (5) save/reload revives records, teeth, and ribbon; (6) removing down
// to one lane auto-decomposes, leaving the survivor two plain reroutes.
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
  const mk = (type, x, y) => { const n = L.createNode(type); n.pos = [x, y]; g.add(n); return n }
  const chain = (link) => {
    const ids = []
    let rid = link.parentId
    while (rid != null) { ids.push(rid); rid = g.getReroute(rid)?.parentId }
    return ids.reverse() // source-side first
  }
  const crossingsOf = (routes) => routes
    .filter((r) => r.key.includes('|X'))
    .map((r) => {
      let best = null, bl = -1
      for (let k = 0; k < r.pts.length - 1; k++) {
        const a = r.pts[k], c = r.pts[k + 1]
        if (Math.abs(a[1] - c[1]) < 0.1 && Math.abs(a[0] - c[0]) > bl) { bl = Math.abs(a[0] - c[0]); best = a[1] }
      }
      return { link: Number(r.key.split('|')[0]), laneY: best, pts: r.pts }
    })

  g.clear()
  app.canvas.links_render_mode = P.PCB()
  const report = {}

  // Three separate source->target links straddling the comb site.
  const s1 = mk('CheckpointLoaderSimple', 100, 100)
  const t1 = mk('CheckpointSave', 1500, 120)
  const s2 = mk('CheckpointLoaderSimple', 100, 400)
  const t2 = mk('CheckpointSave', 1500, 420)
  const s3 = mk('CheckpointLoaderSimple', 100, 700)
  const t3 = mk('CheckpointSave', 1500, 720)
  s1.connect(0, t1, 0); s2.connect(0, t2, 0); s3.connect(0, t3, 0)
  const [l1, l2, l3] = [...g._links.values()].map((l) => l.id)
  await settle()

  // (1) create + spread the gates apart
  const combId = C.create(l1, l2, 700, 300)
  C.move(combId, 'out', 1100, 300)
  await settle()
  report.record = g.extra?.cablemanagement_combs?.length === 1
  report.rerouteCount = g.reroutes.size
  report.chain1 = chain(g._links.get(l1))
  report.chain2 = chain(g._links.get(l2))
  report.lanes = C.list()[0].lanes
  report.teeth1 = report.lanes[0] && [g.getReroute(report.lanes[0].in)?.pos.slice(), g.getReroute(report.lanes[0].out)?.pos.slice()]

  // (2) ribbon pitch + order
  const c2 = crossingsOf(P.routes())
  report.cross2 = c2.map((c) => ({ link: c.link, y: c.laneY })).sort((a, b) => a.y - b.y)

  // (3) third lane
  C.add(combId, l3)
  await settle()
  const c3 = crossingsOf(P.routes()).sort((a, b) => a.laneY - b.laneY)
  report.cross3 = c3.map((c) => ({ link: c.link, y: c.laneY }))

  // (4) obstacle on the corridor: the ribbon template must route around it.
  // x chosen so the 270px-wide node clears both gates AND their 24px ribbon stubs
  // (748 < 780, 1050 < 1076) -- stub directions are binding now, so an obstacle
  // overlapping a stub zone forces the enforced approach through its interior.
  const blocker = mk('EmptyLatentImage', 780, 300)
  await settle()
  const br = blocker.boundingRect
  report.blockerRect = [br[0], br[1], br[2], br[3]]
  const c4 = crossingsOf(P.routes())
  report.avoid = c4.every((c) => {
    for (let k = 0; k < c.pts.length - 1; k++) {
      const a = c.pts[k], d = c.pts[k + 1]
      const x0 = Math.min(a[0], d[0]), x1 = Math.max(a[0], d[0])
      const y0 = Math.min(a[1], d[1]), y1 = Math.max(a[1], d[1])
      if (x1 > br[0] + 1 && x0 < br[0] + br[2] - 1 && y1 > br[1] + 1 && y0 < br[1] + br[3] - 1) return false
    }
    return true
  })
  report.avoidCount = c4.length

  // (5) save/reload
  const data = g.serialize()
  g.configure(data)
  app.canvas.links_render_mode = P.PCB()
  await settle()
  report.reload = {
    records: g.extra?.cablemanagement_combs?.length,
    reroutes: g.reroutes.size,
    crossings: crossingsOf(P.routes()).length
  }

  // (6) remove to one lane -> auto-decompose
  const ids = [...g._links.values()].map((l) => l.id)
  C.remove(combId, ids[2])
  await settle()
  report.afterRemove3 = { records: g.extra.cablemanagement_combs.length, reroutes: g.reroutes.size }
  C.remove(combId, ids[1])
  await settle()
  report.afterRemove2 = {
    records: g.extra.cablemanagement_combs.length,
    reroutes: g.reroutes.size,
    survivorChain: chain(g._links.get(ids[0])).length,
    crossings: crossingsOf(P.routes()).length
  }

  // (7) short ribbons: at spawn the gates TOUCH -- the router's corridor cannot
  // exist there, and it used to wrap a horseshoe OVER both gates. Direct seam
  // mode must keep every crossing point inside the gates' union box, touching
  // and at small offset gaps alike.
  const inBox = (box, m) => crossingsOf(P.routes()).every((c) =>
    c.pts.every((p) =>
      p[0] >= box[0] - m && p[0] <= box[2] + m && p[1] >= box[1] - m && p[1] <= box[3] + m
    )
  )
  const unionBox = () => {
    const c = C.list()[0]
    const h = 24 + (c.lanes.length - 1) * 20
    return [
      Math.min(c.in.pos[0], c.out.pos[0]), Math.min(c.in.pos[1], c.out.pos[1]),
      Math.max(c.in.pos[0], c.out.pos[0]) + 24, Math.max(c.in.pos[1], c.out.pos[1]) + h
    ]
  }
  g.clear()
  app.canvas.links_render_mode = P.PCB()
  const s7a = mk('CheckpointLoaderSimple', 100, 100)
  const t7a = mk('CheckpointSave', 1500, 120)
  const s7b = mk('CheckpointLoaderSimple', 100, 400)
  const t7b = mk('CheckpointSave', 1500, 420)
  s7a.connect(0, t7a, 0); s7b.connect(0, t7b, 0)
  const [l7a, l7b] = [...g._links.values()].map((l) => l.id)
  const short = C.create(l7a, l7b, 700, 260)
  await settle()
  report.shortTouch = { crossings: crossingsOf(P.routes()).length, contained: inBox(unionBox(), 2) }
  const c7 = C.list()[0]
  C.move(short, 'out', c7.in.pos[0] + 24 + 20, c7.in.pos[1] + 70)
  await settle()
  report.shortOffset = { crossings: crossingsOf(P.routes()).length, contained: inBox(unionBox(), 2) }
  return report
})

ok('comb record in graph.extra', out.record)
ok('4 teeth for 2 lanes', out.rerouteCount === 4, `got ${out.rerouteCount}`)
ok('lane 1 chain is in->out', JSON.stringify(out.chain1) === JSON.stringify([out.lanes[0].in, out.lanes[0].out]), `${out.chain1}`)
ok('lane 2 chain is in->out', JSON.stringify(out.chain2) === JSON.stringify([out.lanes[1].in, out.lanes[1].out]), `${out.chain2}`)
ok('2 ribbon crossings', out.cross2.length === 2, `got ${out.cross2.length}`)
if (out.cross2.length === 2) {
  ok('5px pitch (stroke+gap)', Math.abs(out.cross2[1].y - out.cross2[0].y - 5) < 0.5, `dy=${(out.cross2[1].y - out.cross2[0].y).toFixed(1)}`)
  ok('insertion order top-to-bottom', out.cross2[0].link < out.cross2[1].link, JSON.stringify(out.cross2))
}
ok('3 lanes after add', out.cross3.length === 3, `got ${out.cross3.length}`)
if (out.cross3.length === 3) {
  const d1 = out.cross3[1].y - out.cross3[0].y, d2 = out.cross3[2].y - out.cross3[1].y
  ok('pitch preserved at 3', Math.abs(d1 - 5) < 0.5 && Math.abs(d2 - 5) < 0.5, `dys=${d1.toFixed(1)},${d2.toFixed(1)}`)
  ok('order preserved at 3', out.cross3[0].link < out.cross3[1].link && out.cross3[1].link < out.cross3[2].link)
}
ok('ribbon avoids blocker', out.avoid === true, `crossings checked=${out.avoidCount}`)
ok('reload revives comb', out.reload.records === 1 && out.reload.reroutes === 6 && out.reload.crossings === 3, JSON.stringify(out.reload))
ok('remove lane -> 2 lanes, 4 teeth', out.afterRemove3.records === 1 && out.afterRemove3.reroutes === 4, JSON.stringify(out.afterRemove3))
ok('second-to-last removal decomposes', out.afterRemove2.records === 0 && out.afterRemove2.reroutes === 2 && out.afterRemove2.crossings === 0, JSON.stringify(out.afterRemove2))
ok('survivor keeps its two plain reroutes', out.afterRemove2.survivorChain === 2)
ok('touching gates: seam stays inside the gate box', out.shortTouch.crossings === 2 && out.shortTouch.contained, JSON.stringify(out.shortTouch))
ok('short offset gap: seam stays inside the gate box', out.shortOffset.crossings === 2 && out.shortOffset.contained, JSON.stringify(out.shortOffset))
console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
