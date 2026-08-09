// Ledger-fragility catalog (FR&B item 2 hunt, 2026-08-08). Builds daisy-chained
// pass-throughs by real gesture (CK -> A; A' -> B; B' -> C -- link flavour; the
// widget flavour starts from A's text widget so the chain rides a hidden owned
// primitive), then applies one stressor per cell and reports where each hop's
// link is actually DRAWN from (pin / true origin / gone) and which provenance
// records survived. Diagnostic first, suite second: the catalog is the output,
// exit 1 just flags "some cell degraded" for battery-style reading.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })

const STRESSORS = ['baseline', 'move', 'undoredo', 'roundtrip', 'reload', 'unpack']
const results = []

async function drag(page, from, to) {
  await page.mouse.move(...from); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(900)
}
const pinPos = (page, id, kind, idx) => page.evaluate(({ id, kind, idx }) => {
  const sel = idx != null
    ? `.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-index="${idx}"]`
    : `.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-kind="${kind}"]`
  const p = document.querySelector(sel)
  if (!p) return null
  const r = p.getBoundingClientRect(); return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, kind, idx })
const dotPos = (page, id, idx) => page.evaluate(({ id, idx }) => {
  const d = document.querySelector(`[data-slot-key="${id}-in-${idx}"]`)
  if (!d) return null
  const r = d.getBoundingClientRect(); return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx })

async function cell(flavour, stressor, withReroute) {
  const page = await b.newPage({ viewport: { width: 2100, height: 1000 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
  await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForFunction(() => window.app?.graph && window.__cablemanagement, null, { timeout: 120_000 })
  await page.waitForTimeout(2600)

  const ids = await page.evaluate(async ({ flavour }) => {
    const g = window.app.graph, L = window.LiteGraph; g.clear()
    const out = {}
    const A = L.createNode('CLIPTextEncode'); A.pos = [440, 80]; A.title = 'A'; g.add(A); out.A = String(A.id)
    const B = L.createNode('CLIPTextEncode'); B.pos = [980, 80]; B.title = 'B'; g.add(B); out.B = String(B.id)
    const C = L.createNode('CLIPTextEncode'); C.pos = [980, 500]; C.title = 'C'; g.add(C); out.C = String(C.id)
    if (flavour === 'link') {
      const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [30, 60]; g.add(CK); out.O = String(CK.id)
      out.idx = A.inputs.findIndex((s) => s.type === 'CLIP')
      CK.connect(1, A, out.idx)
    } else {
      A.widgets.find((w) => w.name === 'text').value = 'chain value'
      out.idx = A.inputs.findIndex((s) => s.widget?.name === 'text')
    }
    g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
    return out
  }, { flavour })
  const idxOf = (id) => page.evaluate(({ id, flavour }) => {
    const n = window.app.graph.getNodeById(Number(id))
    return flavour === 'link' ? n.inputs.findIndex((s) => s.type === 'CLIP') : n.inputs.findIndex((s) => s.widget?.name === 'text')
  }, { id, flavour })

  const bIdx = await idxOf(ids.B)
  await drag(page, await pinPos(page, ids.A, flavour === 'link' ? 'link' : 'widget', null), await dotPos(page, ids.B, bIdx))
  const cIdx = await idxOf(ids.C)
  const pin2 = await pinPos(page, ids.B, null, bIdx)
  if (!pin2) { results.push({ flavour, stressor, error: 'hop2 pin missing at build' }); await page.close(); return }
  await drag(page, pin2, await dotPos(page, ids.C, cIdx))

  if (withReroute) {
    await page.evaluate(({ ids, cIdx }) => {
      const g = window.app.graph
      const C = g.getNodeById(Number(ids.C))
      const link = g.getLink(C.inputs[cIdx].link)
      g.createReroute([760, 420], link)
      g.setDirtyCanvas(true, true)
    }, { ids, cIdx })
    await page.waitForTimeout(600)
  }

  // ---- stressor ----
  if (stressor === 'move') {
    await page.evaluate(({ ids }) => {
      const B = window.app.graph.getNodeById(Number(ids.B))
      B.pos = [B.pos[0] + 90, B.pos[1] + 60]
      window.app.graph.setDirtyCanvas(true, true)
    }, { ids })
  } else if (stressor === 'undoredo') {
    await page.keyboard.press('Control+z'); await page.waitForTimeout(700)
    await page.keyboard.press('Control+z'); await page.waitForTimeout(700)
    await page.keyboard.press('Control+y'); await page.waitForTimeout(700)
    await page.keyboard.press('Control+y'); await page.waitForTimeout(700)
  } else if (stressor === 'roundtrip') {
    await page.evaluate(async () => {
      const g = window.app.graph
      g.configure(JSON.parse(JSON.stringify(g.serialize())))
      g.setDirtyCanvas(true, true)
    })
  } else if (stressor === 'reload') {
    await page.evaluate(async () => {
      const g = window.app.graph
      const s = JSON.parse(JSON.stringify(g.serialize()))
      await window.app.loadGraphData(s)
    })
  } else if (stressor === 'unpack') {
    await page.evaluate(({ ids }) => {
      const g = window.app.graph
      const pick = ['A', 'B', 'C'].map((t) => g.getNodeById(Number(ids[t])))
      const hidden = g.nodes.filter((n) => n.type === 'PrimitiveNode')
      const { node } = g.convertToSubgraph(new Set([...pick, ...hidden]))
      g.unpackSubgraph(node)
      g.setDirtyCanvas(true, true)
    }, { ids })
  }
  await page.waitForTimeout(1800)

  // ---- measure: where does each hop link DRAW from? ----
  const m = await page.evaluate(async ({ flavour }) => {
    const g = window.app.graph
    const L = window.LiteGraph
    const byTitle = (t) => g.nodes.find((n) => n.title === t)
    const A = byTitle('A'), B = byTitle('B'), C = byTitle('C')
    if (!A || !B || !C) return { error: `nodes missing: A=${!!A} B=${!!B} C=${!!C}` }
    const idxIn = (n) => (flavour === 'link' ? n.inputs.findIndex((s) => s.type === 'CLIP') : n.inputs.findIndex((s) => s.widget?.name === 'text'))
    const bIdx = idxIn(B), cIdx = idxIn(C)

    window.__cablemanagementDraw = new Map()
    window.__cablemanagementCapture = true
    g.setDirtyCanvas(true, true)
    await new Promise((r) => setTimeout(r, 600))

    const TITLE = L?.NODE_TITLE_HEIGHT ?? 30
    const pinAnchor = (node, idx) => {
      const el = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${node.id}"][data-cablemanagement-index="${idx}"]`)
      return el ? [node.pos[0] + el.offsetLeft + el.offsetWidth / 2, node.pos[1] - TITLE + el.offsetTop + el.offsetHeight / 2] : null
    }
    const verdict = (consumer, cidx, expectedPinNode, expectedPinIdx) => {
      const lid = consumer.inputs[cidx]?.link
      if (lid == null) return { v: 'no-link' }
      const link = g.getLink(lid)
      const drawn = window.__cablemanagementDraw.get(lid)
      if (!drawn) return { v: 'not-drawn', lid }
      const start = [drawn[0], drawn[1]]
      const pin = pinAnchor(expectedPinNode, expectedPinIdx)
      const origin = g.getNodeById(link.origin_id)
      const originPos = origin?.getConnectionPos?.(false, link.origin_slot) ?? origin?.pos ?? null
      const near = (p, tol) => p && Math.hypot(start[0] - p[0], start[1] - p[1]) < tol
      const v = near(pin, 4) ? 'pin' : near(originPos, 12) ? 'TRUE-ORIGIN' : `other(${Math.round(start[0])},${Math.round(start[1])})`
      return { v, lid, origin: origin ? `${origin.title ?? origin.type}#${origin.id}` : String(link.origin_id) }
    }
    const prov = (n, idx) => {
      const e = n.properties?.['cablemanagement.from']?.[String(idx)]
      if (!e) return null
      const hostAlive = !!g.nodes.find((x) => String(x.id) === String(e[0]))
      const lid = n.inputs[idx]?.link
      return { rec: e.slice(0, 2), linkMatch: e[2] === lid, hostAlive }
    }
    const led = window.__cablemanagement.ledger()
    window.__cablemanagementCapture = false
    return {
      hop1: verdict(B, bIdx, A, idxIn(A)),
      hop2: verdict(C, cIdx, B, bIdx),
      provB: prov(B, bIdx),
      provC: prov(C, cIdx),
      prims: g.nodes.filter((n) => n.type === 'PrimitiveNode').map((n) => ({ id: String(n.id), hidden: !!n.properties?.['cablemanagement.owned'] })),
      ledger: { size: led.size, lastError: led.lastError },
    }
  }, { flavour })

  results.push({ flavour: flavour + (withReroute ? '+reroute' : ''), stressor, ...m, pageErrors: errs.slice(0, 2) })
  await page.close()
}

for (const flavour of ['link', 'widget']) {
  for (const s of STRESSORS) await cell(flavour, s, false)
}
// reroute-on-chain variant under the two suspects
await cell('link', 'undoredo', true)
await cell('link', 'unpack', true)
await cell('widget', 'unpack', true)

await b.close()
let degraded = 0
for (const r of results) {
  const bad = r.error || r.hop1?.v !== 'pin' || r.hop2?.v !== 'pin' || r.ledger?.lastError
  if (bad) degraded++
  console.log(`${bad ? 'DEGRADED' : 'ok      '} [${r.flavour} x ${r.stressor}] hop1=${r.hop1?.v ?? '-'} hop2=${r.hop2?.v ?? '-'} provB=${JSON.stringify(r.provB)} provC=${JSON.stringify(r.provC)} prims=${JSON.stringify(r.prims)} ledger=${JSON.stringify(r.ledger)} ${r.error ?? ''} ${r.pageErrors?.length ? 'PAGEERR ' + r.pageErrors.join(' | ') : ''}`)
}
console.log(`${results.length} cells, ${degraded} degraded`)
process.exit(degraded ? 1 : 0)
