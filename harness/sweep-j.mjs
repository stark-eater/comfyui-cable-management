// SWEEP cell J: combed WIDGET passthrough built INSIDE a subgraph -- enter/exit
// remount anchor stability.
//   root: A + B loaders -> convertToSubgraph -> enter.
//   inside: add loader C, pin-drag A's widget pin onto B.ckpt and C.ckpt (two
//   passthroughs off one pin), comb the two links via api, move the out gate.
//   invariants (ANCHOR / NO-ORPHANS) after every mutation.
//   exit to root: no phantom routes/gates/draw entries at root.
//   re-enter: pins remount, anchors and comb records intact.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagementPathing?.state?.patched && window.__cablemanagementCombs, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}
const fresh = () => page.evaluate(async () => {
  window.__cablemanagementCapture = true
  window.__cablemanagementDraw = new Map()
  const g = window.app.canvas.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
})
const drag = async (from, to) => {
  await page.mouse.move(from[0], from[1]); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(800)
}

// ---- root scene: two loaders, convert to subgraph -------------------------------
const root = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CheckpointLoaderSimple', 80, 100)
  const B = mk('CheckpointLoaderSimple', 900, 100)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 800))
  const { subgraph } = g.convertToSubgraph(new Set([A, B]))
  return { subId: subgraph.id, rootGraphId: g.id }
})
const enter = () => page.evaluate((subId) => {
  const app = window.app
  const sub = app.graph.subgraphs?.get?.(subId) ?? app.graph.nodes.find((n) => n.subgraph)?.subgraph
  app.canvas.openSubgraph(sub)
}, root.subId)
await enter()
await page.waitForTimeout(1800)
ok('entered subgraph', await page.evaluate(() => window.app.canvas.graph !== window.app.graph))

// resolve inner A/B by position (conversion may re-issue ids), add loader C
const ids = await page.evaluate(async () => {
  const g = window.app.canvas.graph, L = window.LiteGraph
  const loaders = g.nodes.filter((n) => n.type === 'CheckpointLoaderSimple')
  const A = loaders.find((n) => n.pos[0] < 500)
  const B = loaders.find((n) => n.pos[0] >= 500)
  const C = L.createNode('CheckpointLoaderSimple'); C.pos = [900, 420]; g.add(C)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1800))
  return {
    A: String(A.id), B: String(B.id), C: String(C.id),
    iB: B.inputs.findIndex((s) => s.widget?.name === 'ckpt_name'),
    iC: C.inputs.findIndex((s) => s.widget?.name === 'ckpt_name'),
  }
})
const pinPt = () => page.evaluate((i) => {
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    (x) => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'widget'
  )
  const r = el?.getBoundingClientRect()
  return r && r.width > 0 ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, ids)
const slotPt = (key) => page.evaluate((k) => {
  const r = document.querySelector(`[data-slot-key="${k}"]`)?.getBoundingClientRect()
  return r && r.width > 0 ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, key)

// pin must mount inside the subgraph at all -- its absence is itself the finding
let pin0 = await pinPt()
if (!pin0) { await page.waitForTimeout(2500); pin0 = await pinPt() }
ok('A widget pin mounts inside the subgraph', !!pin0,
  JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.cablemanagement-pin')].map((e) => ({ ...e.dataset })))))

// ---- invariant helper (runs against the ACTIVE graph) ---------------------------
// state.pin (graph coords) is the anchor baseline, set after the passthroughs build.
const state = { pin: null }
const inv = async (tag) => {
  await fresh()
  const r = await page.evaluate((arg) => {
    const g = window.app.canvas.graph
    const draw = window.__cablemanagementDraw ?? new Map()
    const owned = g.nodes.filter((n) => n.properties?.['cablemanagement.owned'])
    const origins = owned.map((n) => n.getConnectionPos(false, 0))
    const links = [...g._links.values()].filter((l) =>
      [String(arg.B), String(arg.C)].includes(String(l.target_id)))
    const perLink = links.map((l) => {
      const d = draw.get(l.id) ?? null
      return {
        id: l.id, target: String(l.target_id), d,
        pinDist: d && arg.pin ? +Math.hypot(d[0] - arg.pin[0], d[1] - arg.pin[1]).toFixed(2) : null,
        originDist: d && origins.length
          ? +Math.min(...origins.map((o) => Math.hypot(d[0] - o[0], d[1] - o[1]))).toFixed(1) : null,
      }
    })
    const routes = window.__cablemanagementPathing.routes()
    const badRoutes = routes.filter((r) =>
      origins.some((o) => Math.hypot(r.pts[0][0] - o[0], r.pts[0][1] - o[1]) < 30)).map((r) => r.key)
    const sz = (s) => s?.size ?? s?.length ?? 0
    const combs = g.extra?.cablemanagement_combs ?? []
    const orphanLanes = []
    for (const c of combs) for (const l of c.lanes ?? []) {
      const ri = g.reroutes.get(l.in), ro = g.reroutes.get(l.out)
      if (ri && ro && sz(ri.linkIds) + sz(ri.floatingLinkIds) === 0
        && sz(ro.linkIds) + sz(ro.floatingLinkIds) === 0)
        orphanLanes.push({ comb: c.id, in: l.in, out: l.out })
    }
    const orphanReroutes = [...(g.reroutes?.values() ?? [])]
      .filter((r) => sz(r.linkIds) + sz(r.floatingLinkIds) === 0).map((r) => r.id)
    const thinCombs = combs.filter((c) => (c.lanes?.length ?? 0) < 2).map((c) => c.id)
    return { perLink, badRoutes, orphanLanes, orphanReroutes, thinCombs, owned: owned.length, combs: combs.length }
  }, { ...ids, pin: state.pin })
  ok(`[${tag}] both passthrough links present and drawn`,
    r.perLink.length === 2 && r.perLink.every((l) => l.d), JSON.stringify(r.perLink))
  if (state.pin) ok(`[${tag}] ANCHOR: draw starts on the baseline pin (<=1.5px)`,
    r.perLink.every((l) => l.pinDist !== null && l.pinDist <= 1.5), JSON.stringify(r.perLink))
  ok(`[${tag}] ANCHOR: no draw start within 30px of true origin`,
    r.perLink.every((l) => l.originDist === null || l.originDist >= 30), JSON.stringify(r.perLink))
  ok(`[${tag}] ANCHOR: no route minted from true origin`, r.badRoutes.length === 0, JSON.stringify(r.badRoutes))
  ok(`[${tag}] NO-ORPHANS: lanes carry links`, r.orphanLanes.length === 0, JSON.stringify(r.orphanLanes))
  ok(`[${tag}] NO-ORPHANS: no wireless reroutes`, r.orphanReroutes.length === 0, JSON.stringify(r.orphanReroutes))
  ok(`[${tag}] NO-ORPHANS: no comb with <2 lanes`, r.thinCombs.length === 0, JSON.stringify(r.thinCombs))
  return r
}

if (!pin0) {
  console.log('FAIL blocked: cannot build passthroughs without the pin')
  console.log('page errors:', errs.length ? errs : 'none')
  console.log('FAIL')
  await b.close()
  process.exit(1)
}

// ---- two widget passthroughs off A's pin ----------------------------------------
await drag(pin0, await slotPt(`${ids.B}-in-${ids.iB}`))
await page.waitForTimeout(1200)
const p1 = await page.evaluate((i) => {
  const g = window.app.canvas.graph
  const H = g.nodes.filter((n) => n.properties?.['cablemanagement.owned'])
  const l = [...g._links.values()].find((x) => String(x.target_id) === String(i.B))
  return { owned: H.length, linked: !!l && H.some((h) => String(h.id) === String(l.origin_id)) }
}, ids)
ok('passthrough 1 (A pin -> B.ckpt): owned primitive + link', p1.owned >= 1 && p1.linked, JSON.stringify(p1))

const pin1 = await pinPt() // re-find: the drop can re-render the pin
ok('pin still mounted after first drop', !!pin1)
if (pin1) await drag(pin1, await slotPt(`${ids.C}-in-${ids.iC}`))
await page.waitForTimeout(1200)
const p2 = await page.evaluate((i) => {
  const g = window.app.canvas.graph
  const H = g.nodes.filter((n) => n.properties?.['cablemanagement.owned'])
  const l = [...g._links.values()].find((x) => String(x.target_id) === String(i.C))
  return { owned: H.length, linked: !!l && H.some((h) => String(h.id) === String(l.origin_id)) }
}, ids)
ok('passthrough 2 (A pin -> C.ckpt): link from an owned primitive', p2.linked, JSON.stringify(p2))

// baseline anchor = effective draw start of the B link at rest
await fresh()
state.pin = await page.evaluate((i) => {
  const g = window.app.canvas.graph
  const l = [...g._links.values()].find((x) => String(x.target_id) === String(i.B))
  return (l && window.__cablemanagementDraw.get(l.id)?.slice(0, 2)) ?? null
}, ids)
ok('baseline pin anchor captured', !!state.pin, JSON.stringify(state.pin))
await inv('built')

// ---- comb the two links via api, then move the out gate -------------------------
const combed = await page.evaluate((i) => {
  const g = window.app.canvas.graph
  const lB = [...g._links.values()].find((x) => String(x.target_id) === String(i.B))
  const lC = [...g._links.values()].find((x) => String(x.target_id) === String(i.C))
  const id = window.__cablemanagementCombs.create(lB.id, lC.id, 500, 240)
  return { id, lB: lB.id, lC: lC.id, rec: g.extra?.cablemanagement_combs?.find((c) => c.id === id) ?? null }
}, ids)
ok('comb created in the SUBGRAPH extra', !!combed.rec && combed.rec.lanes?.length === 2, JSON.stringify(combed))
await inv('comb-created')

await page.evaluate((c) => { window.__cablemanagementCombs.move(c.id, 'out', 700, 240) }, combed)
await inv('out-gate-moved')

// ---- exit to root: nothing of the subgraph comb may leak ------------------------
await page.evaluate(() => { location.hash = '#' + window.app.graph.id })
await page.waitForTimeout(1800)
ok('back at root', await page.evaluate(() => window.app.canvas.graph === window.app.graph))
await fresh()
const rootView = await page.evaluate((c) => {
  const g = window.app.graph
  return {
    rootCombs: (g.extra?.cablemanagement_combs ?? []).length,
    rootLinks: g._links.size,
    drawEntries: [...(window.__cablemanagementDraw ?? new Map()).keys()],
    routes: window.__cablemanagementPathing.routes().map((r) => r.key),
    subLinkRoutes: window.__cablemanagementPathing.routes()
      .filter((r) => String(r.key).includes(String(c.lB)) || String(r.key).includes(String(c.lC)))
      .map((r) => r.key),
  }
}, combed)
ok('root has no comb records', rootView.rootCombs === 0, JSON.stringify(rootView))
ok('root draws no phantom routes', rootView.routes.length === 0, JSON.stringify(rootView.routes))
ok('root draws no phantom links', rootView.drawEntries.length === 0, JSON.stringify(rootView.drawEntries))

// ---- re-enter: remount rebuilds DOM pins; anchors + records must hold -----------
await enter()
await page.waitForTimeout(2000)
ok('re-entered subgraph', await page.evaluate(() => window.app.canvas.graph !== window.app.graph))
let pin2 = await pinPt()
if (!pin2) { await page.waitForTimeout(2500); pin2 = await pinPt() }
ok('pin remounts after re-enter', !!pin2,
  JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.cablemanagement-pin')].map((e) => ({ ...e.dataset })))))
const rec2 = await page.evaluate((c) =>
  window.app.canvas.graph.extra?.cablemanagement_combs?.find((x) => x.id === c.id) ?? null, combed)
ok('comb record survives the round trip', !!rec2 && rec2.lanes?.length === 2, JSON.stringify(rec2))
await inv('re-entered')

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
