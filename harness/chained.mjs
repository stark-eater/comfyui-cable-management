// Chained pass-throughs: drag a pin whose input was itself fed by a pass-through drop.
// S1 link chain:   CK -> A.clip;  A' -> B.clip;  then B' -> C.clip   (origin = real node)
// S2 widget chain: A.text literal; A' -> B.text; then B' -> C.text  (origin = HIDDEN primitive)
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })

async function drag(page, from, to, pinOwner) {
  await page.mouse.move(...from); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  // Where does the preview START right now -- the pin, or the true origin?
  const mid = await page.evaluate(({ pinOwner }) => {
    const rls = window.app.canvas?.linkConnector?.renderLinks ?? []
    const rl = rls[0]
    let want = null
    if (pinOwner) {
      const el = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${pinOwner.id}"][data-cablemanagement-index="${pinOwner.idx}"]`)
      const n = window.app.graph.getNodeById(Number(pinOwner.id))
      const TITLE = window.LiteGraph?.NODE_TITLE_HEIGHT ?? 30
      if (el && n) want = [n.pos[0] + el.offsetLeft + el.offsetWidth / 2, n.pos[1] - TITLE + el.offsetTop + el.offsetHeight / 2]
    }
    return {
      n: rls.length,
      fromPos: rl?.fromPos ? [Math.round(rl.fromPos[0]), Math.round(rl.fromPos[1])] : null,
      want: want && [Math.round(want[0]), Math.round(want[1])],
    }
  }, { pinOwner })
  await page.mouse.up(); await page.waitForTimeout(900)
  return mid
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

async function scenario(kind) {
  const page = await b.newPage({ viewport: { width: 2100, height: 1000 } })
  const errs = []
  page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
  await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
  await page.waitForTimeout(3000)
  const ids = await page.evaluate(async ({ kind }) => {
    const g = window.app.graph, L = window.LiteGraph; g.clear()
    const out = {}
    if (kind === 'link') {
      const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [30, 60]; g.add(CK); out.O = String(CK.id)
    }
    const A = L.createNode('CLIPTextEncode'); A.pos = [440, 80]; A.title = 'A'; g.add(A); out.A = String(A.id)
    const B = L.createNode('CLIPTextEncode'); B.pos = [980, 80]; B.title = 'B'; g.add(B); out.B = String(B.id)
    const C = L.createNode('CLIPTextEncode'); C.pos = [980, 500]; C.title = 'C'; g.add(C); out.C = String(C.id)
    if (kind === 'link') {
      const CK = g.getNodeById(Number(out.O))
      CK.connect(1, A, A.inputs.findIndex(s => s.type === 'CLIP'))
      out.idx = A.inputs.findIndex(s => s.type === 'CLIP')
    } else {
      const wa = A.widgets.find(w => w.name === 'text'); wa.value = 'chain value'
      out.idx = A.inputs.findIndex(s => s.widget?.name === 'text')
    }
    g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
    return out
  }, { kind })
  const idxOf = (id) => page.evaluate(({ id, kind }) => {
    const n = window.app.graph.getNodeById(Number(id))
    return kind === 'link' ? n.inputs.findIndex(s => s.type === 'CLIP') : n.inputs.findIndex(s => s.widget?.name === 'text')
  }, { id, kind })

  // Hop 1: A' -> B
  const pin1 = await pinPos(page, ids.A, kind === 'link' ? 'link' : 'widget', null)
  const bIdx = await idxOf(ids.B)
  const tgt1 = await dotPos(page, ids.B, bIdx)
  const mid1 = await drag(page, pin1, tgt1, { id: ids.A, idx: ids.idx })

  // Hop 2: B' (B's input pin, now fed via the pass-through) -> C
  const pin2 = await pinPos(page, ids.B, null, bIdx)
  const cIdx = await idxOf(ids.C)
  const tgt2 = await dotPos(page, ids.C, cIdx)
  const mid2 = pin2 && tgt2 ? await drag(page, pin2, tgt2, { id: ids.B, idx: bIdx }) : null

  const after = await page.evaluate(async ({ ids, bIdx, cIdx }) => {
    const g = window.app.graph
    const B = g.getNodeById(Number(ids.B)), C = g.getNodeById(Number(ids.C))
    const lb = B.inputs[bIdx].link != null ? g.getLink(B.inputs[bIdx].link) : null
    const lc = C.inputs[cIdx].link != null ? g.getLink(C.inputs[cIdx].link) : null
    const p = await window.app.graphToPrompt()
    return {
      bOrigin: lb ? String(lb.origin_id) : null, cOrigin: lc ? String(lc.origin_id) : null,
      bProv: B.properties?.['cablemanagement.from']?.[String(bIdx)]?.slice(0, 2) ?? null,
      cProv: C.properties?.['cablemanagement.from']?.[String(cIdx)]?.slice(0, 2) ?? null,
      prims: g.nodes.filter(n => n.type === 'PrimitiveNode').map(n => String(n.id)),
      cText: p.output?.[ids.C]?.inputs?.text,
      ledger: window.__cablemanagement?.ledger()?.size ?? 0,
    }
  }, { ids, bIdx, cIdx })
  console.log(`[${kind}] hop1`, JSON.stringify(mid1), `hop2 pin=${pin2 ? 'found' : 'MISSING'}`, JSON.stringify(mid2))
  console.log(`[${kind}]`, JSON.stringify(after))
  const anchored = (m) => m && m.fromPos && m.want && Math.abs(m.fromPos[0] - m.want[0]) < 2 && Math.abs(m.fromPos[1] - m.want[1]) < 2
  const wantOrigin = kind === 'link' ? ids.O : after.prims[0]
  const pass = mid1.n > 0 && mid2.n > 0 && anchored(mid1) && anchored(mid2) && after.cOrigin === wantOrigin &&
    JSON.stringify(after.cProv) === JSON.stringify([ids.B, bIdx]) &&
    (kind === 'link' || after.cText === 'chain value')
  console.log(`[${kind}]`, pass ? 'PASS' : 'FAIL', '| page errors:', errs.length)
  errs.slice(0, 3).forEach(e => console.log('  ' + e.slice(0, 140)))
  await page.close()
  return pass
}

const p1 = await scenario('link')
const p2 = await scenario('widget')
await b.close()
process.exit(p1 && p2 ? 0 : 1)
