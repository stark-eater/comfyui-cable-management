// The move seam: pick up a re-anchored widget pass-through link at B's input and drag it
// to C. The preview must anchor to A's pin (not the hidden primitive), the drop must move
// provenance to C, and B's stale record must prune.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const A = L.createNode('CLIPTextEncode'); A.pos = [140, 120]; A.title = 'A'; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos = [760, 120]; B.title = 'B'; g.add(B)
  const C = L.createNode('CLIPTextEncode'); C.pos = [760, 470]; C.title = 'C'; g.add(C)
  const wa = A.widgets.find(w => w.name === 'text'); wa.value = 'moved value'
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return { A: String(A.id), B: String(B.id), C: String(C.id) }
})
const slotCentre = (id, name) => page.evaluate(({ id, name }) => {
  const g = window.app.graph, n = g.getNodeById(Number(id))
  const k = n.inputs.findIndex(s => s.widget?.name === name)
  const d = document.querySelector(`[data-slot-key="${id}-in-${k}"]`)
  const r = d.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, { id, name })

// Step 1: create the pass-through A.text -> B.text.
const pin = await page.evaluate(i => {
  const p = [...document.querySelectorAll('.cablemanagement-pin')].find(x => x.dataset.cablemanagementNode === i.A && x.dataset.cablemanagementKind === 'widget')
  const r = p.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
const bIn = await slotCentre(ids.B, 'text')
await page.mouse.move(...pin); await page.mouse.down()
await page.mouse.move(bIn[0], bIn[1], { steps: 12 }); await page.waitForTimeout(300)
await page.mouse.up(); await page.waitForTimeout(1200)

// Step 2: grab the link at B's input and drag toward C. Mid-drag, compare the preview's
// fromPos with the pin's true graph-space position.
const cIn = await slotCentre(ids.C, 'text')
await page.mouse.move(bIn[0], bIn[1]); await page.mouse.down()
await page.mouse.move((bIn[0] + cIn[0]) / 2, (bIn[1] + cIn[1]) / 2, { steps: 8 })
await page.waitForTimeout(300)
const during = await page.evaluate(i => {
  const rls = window.app.canvas?.linkConnector?.renderLinks ?? []
  const rl = rls[0]
  const el = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${i.A}"][data-cablemanagement-kind="widget"]`)
  const g = window.app.graph, A = g.getNodeById(Number(i.A))
  const TITLE = window.LiteGraph?.NODE_TITLE_HEIGHT ?? 30
  const want = el ? [A.pos[0] + el.offsetLeft + el.offsetWidth / 2, A.pos[1] - TITLE + el.offsetTop + el.offsetHeight / 2] : null
  return { renderLinks: rls.length, fromPos: rl ? [Math.round(rl.fromPos[0]), Math.round(rl.fromPos[1])] : null, want: want && [Math.round(want[0]), Math.round(want[1])] }
}, ids)
await page.mouse.move(cIn[0], cIn[1], { steps: 8 }); await page.waitForTimeout(200)
await page.mouse.up(); await page.waitForTimeout(1200)

const after = await page.evaluate(async i => {
  const g = window.app.graph
  const B = g.getNodeById(Number(i.B)), C = g.getNodeById(Number(i.C))
  const kb = B.inputs.findIndex(s => s.widget?.name === 'text')
  const kc = C.inputs.findIndex(s => s.widget?.name === 'text')
  const p = await window.app.graphToPrompt()
  return {
    bLinked: B.inputs[kb].link != null, cLinked: C.inputs[kc].link != null,
    bProv: B.properties?.['cablemanagement.from']?.[String(kb)] ?? null,
    cProv: C.properties?.['cablemanagement.from']?.[String(kc)] ?? null,
    cText: p.output[i.C]?.inputs?.text,
    prims: g.nodes.filter(n => n.type === 'PrimitiveNode').length,
    ledger: window.__cablemanagement.ledger().size,
  }
}, ids)
console.log('during:', JSON.stringify(during))
console.log('after :', JSON.stringify(after))
const anchored = during.fromPos && during.want && Math.abs(during.fromPos[0] - during.want[0]) < 2 && Math.abs(during.fromPos[1] - during.want[1]) < 2
// bProv stays as a DORMANT record since the midchain round (2b): prune keeps
// disconnected-input records as route memory for the fallback walk. It must
// still name the dead link (self-invalidating), never a live one.
const bProvDormant = after.bProv === null || (!after.bLinked && after.bProv[2] != null)
const pass = anchored && !after.bLinked && after.cLinked && bProvDormant &&
  JSON.stringify(after.cProv?.slice(0, 2)) === JSON.stringify([ids.A, 1]) &&
  after.cText === 'moved value' && after.prims === 1 && after.ledger === 1
console.log('preview anchored to pin:', anchored ? 'YES' : 'NO')
console.log(pass ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
