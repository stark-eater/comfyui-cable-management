// Barney's floating_input.json repro: pull from a PreviewAny "source" pin and
// drop on the ribbon's unpopulated IN pin. The wire must APPARENTLY come from
// the pulled pin (record + draw), even though it physically descends from the
// true origin (AddTextPrefix).
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const wf = JSON.parse(readFileSync('E:/Projects/ComfyUI-vanilla/user/default/workflows/floating_input.json', 'utf8'))
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
await page.evaluate(async (wf) => { await window.app.loadGraphData(wf) }, wf)
await page.waitForTimeout(2500)

// The unpopulated lane: the floating link with a real target and no source.
const scene = await page.evaluate(() => {
  const g = window.app.graph
  const fl = [...(g.floatingLinks?.values?.() ?? [])].find((f) => String(f.origin_id) === '-1' && String(f.target_id) !== '-1')
  if (!fl) return null
  const combs = g.extra.cablemanagement_combs
  let laneIdx = -1, comb = null
  for (const c of combs) {
    laneIdx = c.lanes.findIndex((l) => l.in === fl.parentId || l.out === fl.parentId)
    if (laneIdx >= 0) { comb = c; break }
  }
  if (!comb) return null
  const GATE_W = 24, PAD = 12, PITCH = 20
  const [x, y] = comb.in.pos
  const gx = comb.in.pins === 'left' ? x + 5 : x + GATE_W - 5
  const gy = y + PAD + laneIdx * PITCH
  let pull = null
  for (const n of g.nodes) {
    if (n.type !== 'PreviewAny') continue
    const idx = n.inputs.findIndex((s) => s.link != null)
    if (idx < 0) continue
    const el = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${n.id}"][data-cablemanagement-index="${idx}"]`)
    if (!el?.getBoundingClientRect().width) continue
    const r = el.getBoundingClientRect()
    pull = { node: String(n.id), idx, at: [r.x + r.width / 2, r.y + r.height / 2] }
    break
  }
  const ds = window.app.canvas.ds
  const view = window.app.canvas.canvas.getBoundingClientRect()
  return {
    target: String(fl.target_id), tSlot: fl.target_slot, pull,
    gate: [view.left + (gx + ds.offset[0]) * ds.scale, view.top + (gy + ds.offset[1]) * ds.scale],
  }
})
ok('scene: unpopulated lane + a fed PreviewAny pin found', !!scene?.pull, JSON.stringify(scene))

await page.mouse.move(...scene.pull.at); await page.mouse.down()
await page.mouse.move(scene.gate[0], scene.gate[1], { steps: 12 }); await page.waitForTimeout(300)
await page.mouse.up(); await page.waitForTimeout(1200)

const after = await page.evaluate(async ({ target, tSlot, pull }) => {
  const g = window.app.graph, L = window.LiteGraph
  const t = g.getNodeById(Number(target))
  const lid = t?.inputs?.[tSlot]?.link
  const link = lid != null ? g.getLink(lid) : null
  const rec = t?.properties?.['cablemanagement.from']?.[String(tSlot)] ?? null
  window.__cablemanagementDraw = new Map(); window.__cablemanagementCapture = true
  for (let i = 0; i < 4; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
  window.__cablemanagementCapture = false
  const d = lid != null ? window.__cablemanagementDraw.get(lid) : null
  const TITLE = L?.NODE_TITLE_HEIGHT ?? 30
  const pn = g.getNodeById(Number(pull.node))
  const el = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${pull.node}"][data-cablemanagement-index="${pull.idx}"]`)
  const pinPos = el && pn ? [pn.pos[0] + el.offsetLeft + el.offsetWidth / 2, pn.pos[1] - TITLE + el.offsetTop + el.offsetHeight / 2] : null
  return {
    linked: link != null, origin: link ? String(link.origin_id) : null, threaded: link?.parentId != null,
    rec, drawStart: d ? [Math.round(d[0]), Math.round(d[1])] : null,
    pin: pinPos ? [Math.round(pinPos[0]), Math.round(pinPos[1])] : null,
  }
}, scene)
ok('drop: target really connected through the lane', after.linked && after.threaded, JSON.stringify(after))
ok('drop: record names the pulled pin', String(after.rec?.[0]) === scene.pull.node && after.rec?.[1] === scene.pull.idx, JSON.stringify(after.rec))
ok('drop: wire DRAWS from the pulled pin, not the true origin',
  after.drawStart && after.pin && Math.hypot(after.drawStart[0] - after.pin[0], after.drawStart[1] - after.pin[1]) < 4,
  JSON.stringify({ drawStart: after.drawStart, pin: after.pin }))

console.log('page errors:', errs.length ? errs.slice(0, 4) : 'none')
if (errs.length) pass = false
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
