// Strand 1: is the stand-in a STOCK widget, enabled, and does it stay out of the workflow
// and out of the prompt?
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1700, height: 950 } })
const errs = []; page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph
  g.clear()
  const A = L.createNode('CLIPTextEncode'); A.pos=[140,140]; A.title='A'; g.add(A)
  const B = L.createNode('CLIPTextEncode'); B.pos=[760,140]; B.title='B'; g.add(B)
  g.setDirtyCanvas(true,true); await new Promise(r=>setTimeout(r,1600))
  return { A:String(A.id), B:String(B.id) }
})
const wpin = await page.evaluate(i => { const p=[...document.querySelectorAll('.cablemanagement-pin')].find(x=>x.dataset.cablemanagementNode===i.A&&x.dataset.cablemanagementKind==='widget'); const r=p.getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2] }, ids)
const wtgt = await page.evaluate(i => { const g=window.app.graph,B=g.getNodeById(Number(i.B)); const k=B.inputs.findIndex(s=>s.widget?.name==='text'); const d=document.querySelector(`[data-slot-key="${i.B}-in-${k}"]`); const r=d.getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2] }, ids)
await page.mouse.move(...wpin); await page.mouse.down(); await page.mouse.move(wtgt[0],wtgt[1],{steps:12}); await page.mouse.up()
await page.mouse.move(900,820)
await page.waitForTimeout(1600)

const state = await page.evaluate((i) => {
  const g = window.app.graph, A = g.getNodeById(Number(i.A))
  const standin = A.widgets?.find(w => w[Symbol.for('cablemanagement.standin')] !== undefined)
  const el = document.querySelector(`.lg-node[data-node-id="${i.A}"]`)
  const tas = [...(el?.querySelectorAll('textarea') ?? [])]
  return {
    standinExists: !!standin,
    standinType: standin?.type, standinLabel: standin?.label,
    standinSerialize: standin?.serialize, standinOptSerialize: standin?.options?.serialize,
    isLastWidget: A.widgets?.[A.widgets.length-1] === standin,
    hasCustomFieldElements: document.querySelectorAll('.cablemanagement-field').length,
    deadMarked: document.querySelectorAll('[data-cablemanagement-dead]').length,
    textareasOnA: tas.length,
    textareaEnabled: tas.map(t => !t.disabled),
    textareaVisible: tas.map(t => { const r=t.getBoundingClientRect(); const cs=getComputedStyle(t); return r.width>0 && cs.visibility!=='hidden' }),
  }
}, ids)
console.log('stand-in state:', JSON.stringify(state, null, 2))

// type into the ENABLED stock textarea
const enabledSel = await page.evaluate(i => {
  const el = document.querySelector(`.lg-node[data-node-id="${i.A}"]`)
  const t = [...el.querySelectorAll('textarea')].find(x => !x.disabled && getComputedStyle(x).visibility !== 'hidden')
  if (!t) return null
  t.setAttribute('data-probe-target','1'); return true
}, ids)
if (enabledSel) {
  await page.click('[data-probe-target]'); await page.type('[data-probe-target]', 'typed into the stock widget', { delay: 12 })
  await page.waitForTimeout(800)
}
const after = await page.evaluate(async (i) => {
  const g = window.app.graph
  const prim = g.nodes.find(n => n.type === 'PrimitiveNode')
  const p = await window.app.graphToPrompt()
  const ser = JSON.stringify(g.serialize())
  const A = g.getNodeById(Number(i.A))
  return {
    primitiveValue: prim?.widgets?.[0]?.value,
    aTextInPrompt: p.output[i.A]?.inputs?.text,
    bTextInPrompt: p.output[i.B]?.inputs?.text,
    zwspInPrompt: JSON.stringify(p.output).includes('\u200b'),
    zwspInWorkflow: ser.includes('\u200b'),
    widgetsValuesA: JSON.parse(ser).nodes.find(n => String(n.id) === i.A)?.widgets_values,
  }
}, ids)
console.log('after typing:', JSON.stringify(after, null, 2))

const mirror = await page.evaluate((i) => {
  const g = window.app.graph
  const val = (id) => { const n = g.getNodeById(Number(id)); const w = n.widgets?.find(x => x[Symbol.for('cablemanagement.standin')] !== undefined); return w?.value }
  const shown = (id) => { const el = document.querySelector(`.lg-node[data-node-id="${id}"]`); const t = [...el.querySelectorAll('textarea')].find(x => !x.disabled); return t?.value }
  return { standinValueA: val(i.A), standinValueB: val(i.B), shownA: shown(i.A), shownB: shown(i.B) }
}, ids)
console.log('mirroring:', JSON.stringify(mirror, null, 2))
await page.screenshot({ path: 'standin.png' })
console.log('page errors:', errs.length); errs.slice(0,5).forEach(e=>console.log('  '+e.slice(0,140)))
await b.close()
