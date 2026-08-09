// Churn round (FR&B 2b-churn, from Barney's broken.json QA):
// (RT) route provenance -- a ribbon lane remembers its apparent source
//      (routefrom stamps, written while a provenance-carrying link rides it);
//      disconnect the lane's link, then reconnect by pulling the lane's
//      out-tooth back onto the input: the new link must inherit the record
//      and draw from the source pin, not the true origin.
// (P)  poisoned-workflow hygiene -- broken.json carries a self-referential
//      record (C came from C's own pin); loading it must purge that record
//      while keeping D's legitimate one.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
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

async function drag(from, to) {
  await page.mouse.move(...from); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(900)
}
const pinPos = (id, kind, idx) => page.evaluate(({ id, kind, idx }) => {
  const sel = idx != null
    ? `.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-index="${idx}"]`
    : `.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-kind="${kind}"]`
  const p = document.querySelector(sel)
  if (!p) return null
  const r = p.getBoundingClientRect(); return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, kind, idx })
const dotPos = (id, idx) => page.evaluate(({ id, idx }) => {
  const d = document.querySelector(`[data-slot-key="${id}-in-${idx}"]`)
  if (!d) return null
  const r = d.getBoundingClientRect(); return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx })
const screenOf = (gx, gy) => page.evaluate(([gx, gy]) => {
  const { ds } = window.app.canvas
  return [(gx + ds.offset[0]) * ds.scale, (gy + ds.offset[1]) * ds.scale]
}, [gx, gy])

// ---- (RT) route inheritance through a ribbon reconnect ----
const rt = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const mk = (t, x, y) => { const n = L.createNode('CLIPTextEncode'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const A = mk('A', 200, 80), B = mk('B', 1100, 80), B2 = mk('B2', 1100, 420)
  A.widgets.find((w) => w.name === 'text').value = 'v'
  const idx = A.inputs.findIndex((s) => s.widget?.name === 'text')
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  return { A: String(A.id), B: String(B.id), B2: String(B2.id), idx }
})
await drag(await pinPos(rt.A, 'widget', null), await dotPos(rt.B, rt.idx))
await drag(await pinPos(rt.A, 'widget', null), await dotPos(rt.B2, rt.idx))
const rtComb = await page.evaluate(async ({ rt }) => {
  const g = window.app.graph
  const l1 = g.getNodeById(Number(rt.B)).inputs[rt.idx].link
  const l2 = g.getNodeById(Number(rt.B2)).inputs[rt.idx].link
  const combId = window.__cablemanagementCombs.create(l1, l2, 620, 260)
  window.dispatchEvent(new CustomEvent('cablemanagement:resync'))
  await new Promise((x) => setTimeout(x, 900))
  const comb = g.extra.cablemanagement_combs.find((c) => c.id === combId)
  const lane = comb.lanes.find((l) => g.reroutes.get(l.out)?.linkIds?.has?.(Number(l1)))
  const tooth = g.reroutes.get(lane.out)
  return {
    toothPos: [tooth.pos[0], tooth.pos[1]],
    stamp: g.extra.cablemanagement_routefrom?.[String(lane.out)] ?? null,
  }
}, { rt })
ok('RT: lane stamped with apparent source', Array.isArray(rtComb.stamp) && String(rtComb.stamp[0]) === rt.A,
  JSON.stringify(rtComb.stamp))

await page.evaluate(async ({ rt }) => {
  const g = window.app.graph
  g.getNodeById(Number(rt.B)).disconnectInput(rt.idx, true) // lane parks as dangling float
  window.dispatchEvent(new CustomEvent('cablemanagement:resync'))
  g.setDirtyCanvas(true, true); await new Promise((x) => setTimeout(x, 900))
}, { rt })
const noProv = await page.evaluate(({ rt }) => {
  const B = window.app.graph.getNodeById(Number(rt.B))
  const e = B.properties?.['cablemanagement.from']?.[String(rt.idx)]
  return { linked: B.inputs[rt.idx].link != null, dormant: e ?? null }
}, { rt })
// 2e contract: a directly-cut consumer keeps NO memory (its feed above was
// intact) -- the ribbon's routefrom stamp, not this record, carries the
// inheritance the reconnect below proves.
ok('RT: disconnected, record dropped (2e: no memory on a direct cut)', !noProv.linked && noProv.dormant === null, JSON.stringify(noProv))

// reconnect by pulling the lane's out-tooth back onto B's input
await drag(await screenOf(rtComb.toothPos[0], rtComb.toothPos[1]), await dotPos(rt.B, rt.idx))
const rtAfter = await page.evaluate(async ({ rt }) => {
  const g = window.app.graph
  const B = g.getNodeById(Number(rt.B))
  const lid = B.inputs[rt.idx].link
  const e = B.properties?.['cablemanagement.from']?.[String(rt.idx)] ?? null
  // where does it draw from?
  window.__cablemanagementDraw = new Map(); window.__cablemanagementCapture = true
  g.setDirtyCanvas(true, true); await new Promise((x) => setTimeout(x, 600))
  window.__cablemanagementCapture = false
  const d = lid != null ? window.__cablemanagementDraw.get(lid) : null
  const L = window.LiteGraph
  const A = g.getNodeById(Number(rt.A))
  const el = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${rt.A}"][data-cablemanagement-index="${rt.idx}"]`)
  const TITLE = L?.NODE_TITLE_HEIGHT ?? 30
  const pin = el ? [A.pos[0] + el.offsetLeft + el.offsetWidth / 2, A.pos[1] - TITLE + el.offsetTop + el.offsetHeight / 2] : null
  return {
    linked: lid != null,
    prov: e,
    provMatch: e ? e[2] === lid : false,
    fromPin: d && pin ? Math.hypot(d[0] - pin[0], d[1] - pin[1]) < 4 : false,
  }
}, { rt })
ok('RT: reconnect through the lane relinked', rtAfter.linked)
ok('RT: inherited provenance names A', Array.isArray(rtAfter.prov) && String(rtAfter.prov[0]) === rt.A && rtAfter.provMatch,
  JSON.stringify(rtAfter.prov))
ok('RT: draws from A pin again', rtAfter.fromPin)

// ---- (P) poisoned-workflow hygiene: Barney's churn-QA artifact (prompts
// neutralised; provenance structures verbatim incl. the C self-record) ----
const broken = JSON.parse(readFileSync(new URL('./fixture-churn.json', import.meta.url), 'utf8'))
const p = await page.evaluate(async ({ broken }) => {
  await window.app.loadGraphData(broken)
  window.dispatchEvent(new CustomEvent('cablemanagement:resync'))
  await new Promise((x) => setTimeout(x, 1500))
  const g = window.app.graph
  const C = g.getNodeById(21), D = g.getNodeById(22)
  return {
    cSelf: C?.properties?.['cablemanagement.from']?.['3'] ?? null,
    dRec: D?.properties?.['cablemanagement.from']?.['0'] ?? null,
  }
}, { broken })
ok('P: C self-record purged', p.cSelf === null, JSON.stringify(p.cSelf))
ok('P: D legitimate record kept', Array.isArray(p.dRec) && String(p.dRec[0]) === '21', JSON.stringify(p.dRec))

console.log('page errors:', errs.length ? errs.slice(0, 4) : 'none')
if (errs.length) pass = false
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
