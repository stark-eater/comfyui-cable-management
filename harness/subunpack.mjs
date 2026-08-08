// Unpack survival (unpack.js): core's unpackSubgraph re-mints every id and our
// records must ride the re-mint. (W) widget chain: hidden primitive survives
// owned+hidden, links live, provenance translated, value delivered at queue
// time; (L) link chain: links intact from the true origin, drawn from the pins;
// (K) comb built inside a subgraph: record migrated to the root with live
// teeth; (U) undo -> redo of an unpack: the restored state must not resurrect
// stale records (the translation runs after core's afterChange checkpoint --
// this cell is the empirical answer to whether the checkpoint captures pre- or
// post-translation state).
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 2100, height: 1000 } })
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

// Build the widget chain by gesture: A.text literal; A' -> B; B' -> C.
async function buildWidgetChain() {
  const ids = await page.evaluate(async () => {
    const g = window.app.graph, L = window.LiteGraph; g.clear()
    const A = L.createNode('CLIPTextEncode'); A.pos = [440, 80]; A.title = 'A'; g.add(A)
    const B = L.createNode('CLIPTextEncode'); B.pos = [980, 80]; B.title = 'B'; g.add(B)
    const C = L.createNode('CLIPTextEncode'); C.pos = [980, 500]; C.title = 'C'; g.add(C)
    A.widgets.find((w) => w.name === 'text').value = 'chain value'
    const idx = A.inputs.findIndex((s) => s.widget?.name === 'text')
    g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
    return { A: String(A.id), B: String(B.id), C: String(C.id), idx }
  })
  await drag(await pinPos(ids.A, 'widget', null), await dotPos(ids.B, ids.idx))
  await drag(await pinPos(ids.B, null, ids.idx), await dotPos(ids.C, ids.idx))
  return ids
}

const convertAndUnpack = () => page.evaluate(async () => {
  const g = window.app.graph
  const { node } = g.convertToSubgraph(new Set(g.nodes))
  g.unpackSubgraph(node)
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 1600))
})

const measureChain = (flavour) => page.evaluate(async ({ flavour }) => {
  const g = window.app.graph, L = window.LiteGraph
  const byTitle = (t) => g.nodes.find((n) => n.title === t)
  const A = byTitle('A'), B = byTitle('B'), C = byTitle('C')
  const idxIn = (n) => flavour === 'link'
    ? n.inputs.findIndex((s) => s.type === 'CLIP')
    : n.inputs.findIndex((s) => s.widget?.name === 'text')
  const bIdx = idxIn(B), cIdx = idxIn(C)
  window.__cablemanagementDraw = new Map(); window.__cablemanagementCapture = true
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 600))
  window.__cablemanagementCapture = false
  const TITLE = L?.NODE_TITLE_HEIGHT ?? 30
  const pinAnchor = (node, idx) => {
    const el = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${node.id}"][data-cablemanagement-index="${idx}"]`)
    return el ? [node.pos[0] + el.offsetLeft + el.offsetWidth / 2, node.pos[1] - TITLE + el.offsetTop + el.offsetHeight / 2] : null
  }
  const fromPin = (consumer, cidx, pinNode, pinIdx) => {
    const lid = consumer.inputs[cidx]?.link
    if (lid == null) return 'no-link'
    const drawn = window.__cablemanagementDraw.get(lid)
    if (!drawn) return 'not-drawn'
    const pin = pinAnchor(pinNode, pinIdx)
    return pin && Math.hypot(drawn[0] - pin[0], drawn[1] - pin[1]) < 4 ? 'pin' : 'elsewhere'
  }
  const prov = (n, idx) => {
    const e = n.properties?.['cablemanagement.from']?.[String(idx)]
    if (!e) return null
    return {
      hostAlive: !!g.nodes.find((x) => String(x.id) === String(e[0])),
      linkMatch: e[2] === n.inputs[idx]?.link,
    }
  }
  const p = await window.app.graphToPrompt()
  return {
    hop1: fromPin(B, bIdx, A, idxIn(A)),
    hop2: fromPin(C, cIdx, B, bIdx),
    provB: prov(B, bIdx), provC: prov(C, cIdx),
    prims: g.nodes.filter((n) => n.type === 'PrimitiveNode' && n.properties?.['cablemanagement.owned']).length,
    cValue: p.output?.[String(C.id)]?.inputs?.text ?? null,
    ledgerErr: window.__cablemanagement.ledger().lastError,
  }
}, { flavour })

// ---- (W) widget chain ----
await buildWidgetChain()
await convertAndUnpack()
const w = await measureChain('widget')
ok('W: primitive survives owned', w.prims === 1, `prims=${w.prims}`)
ok('W: both hops draw from pins', w.hop1 === 'pin' && w.hop2 === 'pin', `hop1=${w.hop1} hop2=${w.hop2}`)
ok('W: provenance translated', !!w.provB?.hostAlive && !!w.provB?.linkMatch && !!w.provC?.hostAlive && !!w.provC?.linkMatch, JSON.stringify({ b: w.provB, c: w.provC }))
ok('W: value delivered at queue time', w.cValue === 'chain value', `cValue=${JSON.stringify(w.cValue)}`)
ok('W: no ledger error', !w.ledgerErr, String(w.ledgerErr))

// ---- (U) undo -> redo of the unpack: no stale-record resurrection ----
await page.keyboard.press('Control+z'); await page.waitForTimeout(900)
await page.keyboard.press('Control+y'); await page.waitForTimeout(1600)
const u = await measureChain('widget')
ok('U: primitive still owned after undo/redo', u.prims === 1, `prims=${u.prims}`)
ok('U: hops still pin-anchored', u.hop1 === 'pin' && u.hop2 === 'pin', `hop1=${u.hop1} hop2=${u.hop2}`)
ok('U: value still delivered', u.cValue === 'chain value', `cValue=${JSON.stringify(u.cValue)}`)

// ---- (L) link chain ----
const lids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [30, 60]; g.add(CK)
  const A = L.createNode('CLIPTextEncode'); A.pos = [440, 80]; A.title = 'A'; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos = [980, 80]; B.title = 'B'; g.add(B)
  const C = L.createNode('CLIPTextEncode'); C.pos = [980, 500]; C.title = 'C'; g.add(C)
  const idx = A.inputs.findIndex((s) => s.type === 'CLIP')
  CK.connect(1, A, idx)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  return { A: String(A.id), B: String(B.id), C: String(C.id), idx, ck: String(CK.id) }
})
await drag(await pinPos(lids.A, 'link', null), await dotPos(lids.B, lids.idx))
await drag(await pinPos(lids.B, null, lids.idx), await dotPos(lids.C, lids.idx))
await convertAndUnpack()
const l = await measureChain('link')
ok('L: both hops draw from pins', l.hop1 === 'pin' && l.hop2 === 'pin', `hop1=${l.hop1} hop2=${l.hop2}`)
ok('L: provenance translated', !!l.provB?.hostAlive && !!l.provB?.linkMatch && !!l.provC?.hostAlive && !!l.provC?.linkMatch, JSON.stringify({ b: l.provB, c: l.provC }))
ok('L: no ledger error', !l.ledgerErr, String(l.ledgerErr))

// ---- (K) comb inside a subgraph survives the unpack ----
const k = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [60, 200]; g.add(CK)
  const A = L.createNode('CLIPTextEncode'); A.pos = [900, 80]; A.title = 'A'; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos = [900, 460]; B.title = 'B'; g.add(B)
  const ci = (n) => n.inputs.findIndex((s) => s.type === 'CLIP')
  CK.connect(1, A, ci(A)); CK.connect(1, B, ci(B))
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1200))
  const { subgraph, node } = g.convertToSubgraph(new Set(g.nodes))
  window.app.canvas.openSubgraph(subgraph)
  await new Promise((r) => setTimeout(r, 1200))
  const links = [...subgraph._links.values()].filter((l) => {
    const o = subgraph.getNodeById(l.origin_id)
    return o && o.type === 'CheckpointLoaderSimple'
  })
  const combId = window.__cablemanagementCombs.create(links[0].id, links[1].id, 560, 260)
  await new Promise((r) => setTimeout(r, 900))
  const inside = { combs: (subgraph.extra?.cablemanagement_combs ?? []).length, combId }
  location.hash = '#' + window.app.graph.id
  await new Promise((r) => setTimeout(r, 1400))
  g.unpackSubgraph(node)
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 1600))
  const recs = g.extra?.cablemanagement_combs ?? []
  const comb = recs[0]
  const teethAlive = comb ? comb.lanes.every((l) => g.reroutes?.get?.(l.in) && g.reroutes?.get?.(l.out)) : false
  const teethWired = comb ? comb.lanes.every((l) => [...(g.reroutes.get(l.in)?.linkIds ?? [])].some((id) => g._links?.has?.(Number(id)))) : false
  return { inside, rootCombs: recs.length, lanes: comb?.lanes?.length ?? 0, teethAlive, teethWired }
})
ok('K: comb existed inside the subgraph', k.inside.combs === 1 && k.inside.combId != null, JSON.stringify(k.inside))
ok('K: comb record migrated to root', k.rootCombs === 1, `rootCombs=${k.rootCombs}`)
ok('K: both lanes with living teeth', k.lanes === 2 && k.teethAlive, `lanes=${k.lanes} alive=${k.teethAlive}`)
ok('K: teeth carry live wires', k.teethWired, '')

console.log('page errors:', errs.length ? errs.slice(0, 4) : 'none')
if (errs.length) pass = false
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
