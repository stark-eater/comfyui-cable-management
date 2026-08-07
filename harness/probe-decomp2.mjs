// PROBE (QA bug 1, input-passthrough flavour): pins on connected inputs dragged to
// a second consumer (FROM provenance, no owned-primitive fallback), links combed,
// exit gate deleted via selection, then operations -- watch the draw anchors.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagementPathing?.state?.patched && window.__cablemanagementCombs, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

const ids = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  g.clear()
  app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const A = mk('CheckpointLoaderSimple', 80, 100)
  const S1 = mk('CheckpointSave', 620, 80)
  const S2 = mk('CheckpointSave', 1400, 420)
  A.connect(0, S1, 0) // model
  A.connect(1, S1, 1) // clip
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1800))
  return { A: String(A.id), S1: String(S1.id), S2: String(S2.id) }
})
const pinPt = (idx) => page.evaluate(([nid, idx]) => {
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    x => x.dataset.cablemanagementNode === nid && x.dataset.cablemanagementIndex === String(idx)
  )
  const r = el?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, [ids.S1, idx])
const slotPt = (key) => page.evaluate(k => {
  const r = document.querySelector(`[data-slot-key="${k}"]`)?.getBoundingClientRect()
  return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, key)
const drag = async (from, to) => {
  await page.mouse.move(from[0], from[1]); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(800)
}
const p0 = await pinPt(0)
console.log('pin datasets:', await page.evaluate(() => [...document.querySelectorAll('.cablemanagement-pin')].map(e => ({ ...e.dataset }))))
await drag(p0, await slotPt(`${ids.S2}-in-0`))
await drag(await pinPt(1), await slotPt(`${ids.S2}-in-1`))

const state = (tag) => page.evaluate((arg) => {
  const g = window.app.graph
  const A = g.getNodeById(arg.A) ?? g.getNodeById(Number(arg.A))
  const S2 = g.getNodeById(arg.S2) ?? g.getNodeById(Number(arg.S2))
  const links = [...g._links.values()].filter(l => String(l.target_id) === String(arg.S2))
  const draw = window.__cablemanagementDraw ?? new Map()
  return {
    tag: arg.tag,
    aOut: [A.getConnectionPos(false, 0), A.getConnectionPos(false, 1)],
    prov: S2?.properties?.['cablemanagement.from'] ?? null,
    ledger: window.__cablemanagement.ledger().size,
    links: links.map(l => ({ id: l.id, slot: l.target_slot, parentId: l.parentId ?? null, draw: draw.get(l.id) ?? null })),
    reroutes: [...(g.reroutes?.values() ?? [])].map(r => ({ id: r.id, pos: r.pos.slice() })),
    combs: (g.extra?.cablemanagement_combs ?? []).length
  }
}, { ...ids, tag })
const fresh = () => page.evaluate(async () => {
  window.__cablemanagementCapture = true
  window.__cablemanagementDraw = new Map()
  const g = window.app.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
})
await fresh()
console.log('== base', JSON.stringify(await state('base')))

await page.evaluate((ids) => {
  const g = window.app.graph
  const links = [...g._links.values()].filter(l => String(l.target_id) === String(ids.S2)).map(l => l.id)
  const id = window.__cablemanagementCombs.create(links[0], links[1], 900, 260)
  window.__cablemanagementCombs.move(id, 'out', 1150, 260)
}, ids)
await fresh()
console.log('== combed', JSON.stringify(await state('combed')))

const outGate = await page.evaluate(() => {
  const c = window.app.graph.extra.cablemanagement_combs[0]
  const h = 24 + (c.lanes.length - 1) * 20
  const { ds } = window.app.canvas
  return [(c.out.pos[0] + 12 + ds.offset[0]) * ds.scale, (c.out.pos[1] + h / 2 + ds.offset[1]) * ds.scale]
})
await page.mouse.click(outGate[0], outGate[1])
await page.waitForTimeout(300)
await page.keyboard.press('Delete')
await page.waitForTimeout(600)
await fresh()
console.log('== decomposed', JSON.stringify(await state('decomposed')))

// Op 1: mouse-drag a leftover reroute a little.
const rr = await page.evaluate(() => {
  const r = [...window.app.graph.reroutes.values()][0]
  const { ds } = window.app.canvas
  return [(r.pos[0] + ds.offset[0]) * ds.scale, (r.pos[1] + ds.offset[1]) * ds.scale]
})
await drag(rr, [rr[0] - 60, rr[1] + 80])
await fresh()
console.log('== reroute dragged', JSON.stringify(await state('rdrag')))

// Op 2: new unrelated link.
await page.evaluate(() => {
  const g = window.app.graph, L = window.LiteGraph
  const E = L.createNode('EmptyLatentImage'); E.pos = [80, 700]; g.add(E)
  const S = L.createNode('LatentCompositeMasked'); S.pos = [600, 700]; g.add(S)
  E.connect(0, S, S.inputs.findIndex(s => s.name === 'destination'))
})
await fresh()
console.log('== new link', JSON.stringify(await state('newlink')))

console.log('page errors:', errs.length ? errs : 'none')
await b.close()
