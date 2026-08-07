// PROBE (QA bug: post-decomposition reroutes unstable): widget passthrough A->B1/B2
// via pin drags (owned primitive H drives both), comb the two links, decompose,
// then poke the graph with operations and watch where the links DRAW from.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagementPathing?.state?.patched && window.__cablemanagementCombs, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

const settle = () => page.evaluate(async () => {
  const g = window.app.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
})

const ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CheckpointLoaderSimple', 80, 100)
  const B1 = mk('CheckpointLoaderSimple', 1200, 60)
  const B2 = mk('CheckpointLoaderSimple', 1200, 420)
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1800))
  return {
    A: String(A.id), B1: String(B1.id), B2: String(B2.id),
    i1: B1.inputs.findIndex(s => s.widget?.name === 'ckpt_name'),
    i2: B2.inputs.findIndex(s => s.widget?.name === 'ckpt_name')
  }
})
const pinPt = () => page.evaluate(i => {
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    x => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'widget'
  )
  const r = el?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, ids)
const slotPt = (key) => page.evaluate(k => {
  const r = document.querySelector(`[data-slot-key="${k}"]`)?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, key)
const drag = async (from, to) => {
  await page.mouse.move(from[0], from[1]); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(800)
}
await drag(await pinPt(), await slotPt(`${ids.B1}-in-${ids.i1}`))
await drag(await pinPt(), await slotPt(`${ids.B2}-in-${ids.i2}`))

const state = (tag) => page.evaluate((tag) => {
  const g = window.app.graph
  window.__cablemanagementCapture = true
  const H = g.nodes.find(n => n.properties?.['cablemanagement.owned'])
  const links = [...g._links.values()].filter(l => String(l.origin_id) === String(H?.id))
  const draw = window.__cablemanagementDraw ?? new Map()
  return {
    tag,
    H: H ? { id: H.id, pos: H.pos.slice(), out: H.getConnectionPos(false, 0) } : null,
    ledger: window.__cablemanagement.ledger().size,
    links: links.map(l => ({
      id: l.id, target: l.target_id, parentId: l.parentId ?? null,
      draw: draw.get(l.id) ?? null
    })),
    reroutes: [...(g.reroutes?.values() ?? [])].map(r => ({ id: r.id, pos: r.pos.slice(), parentId: r.parentId ?? null, links: [...(r.linkIds ?? [])] })),
    combs: (g.extra?.cablemanagement_combs ?? []).length,
    routes: window.__cablemanagementPathing.routes().map(r => ({ key: r.key.slice(0, 40), first: r.pts[0], last: r.pts[r.pts.length - 1] }))
  }
}, tag)

await settle()
console.log('== after passthroughs', JSON.stringify(await state('base'), null, 1))

// Comb the two links, then decompose (api flavour first).
await page.evaluate(() => {
  const g = window.app.graph
  const links = [...g._links.values()].map(l => l.id)
  const id = window.__cablemanagementCombs.create(links[0], links[1], 700, 260)
  window.__cablemanagementCombs.move(id, 'out', 1000, 260)
  window.__cablemanagement._lastComb = id
})
await settle()
console.log('== combed', JSON.stringify(await state('combed'), null, 1))

// Observed flavour: select the EXIT gate, press Delete -- dissolveComb removes the
// out teeth, the record dies, the in column decomposes to plain reroutes.
const outGate = await page.evaluate(() => {
  const c = window.app.graph.extra.cablemanagement_combs[0]
  const h = 24 + (c.lanes.length - 1) * 20
  const { ds } = window.app.canvas
  const gx = c.out.pos[0] + 12, gy = c.out.pos[1] + h / 2
  return [(gx + ds.offset[0]) * ds.scale, (gy + ds.offset[1]) * ds.scale]
})
await page.mouse.click(outGate[0], outGate[1])
await page.waitForTimeout(300)
await page.keyboard.press('Delete')
await page.waitForTimeout(600)
await settle()
console.log('== decomposed', JSON.stringify(await state('decomposed'), null, 1))

// Operation 1: move a node (obstacle change, no ledger rebuild).
await page.evaluate(() => {
  const g = window.app.graph
  const B = g.nodes.find(n => n.title?.includes?.('Load') && n.pos[1] > 300 && n.pos[0] > 1000)
  if (B) B.pos = [B.pos[0] + 40, B.pos[1] + 40]
})
await settle()
console.log('== after node move', JSON.stringify(await state('moved'), null, 1))

// Operation 2: add an unrelated link (ledger rebuild trigger).
await page.evaluate(() => {
  const g = window.app.graph, L = window.LiteGraph
  const E = L.createNode('EmptyLatentImage'); E.pos = [80, 700]; g.add(E)
  const S = L.createNode('LatentCompositeMasked'); S.pos = [600, 700]; g.add(S)
  E.connect(0, S, S.inputs.findIndex(s => s.name === 'destination'))
})
await settle()
console.log('== after new link', JSON.stringify(await state('newlink'), null, 1))

console.log('page errors:', errs.length ? errs : 'none')
await b.close()
