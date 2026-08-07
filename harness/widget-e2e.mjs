// Full widget pass-through path, driven by a real mouse:
//   1. an UNCONNECTED widget row carries a pin
//   2. dragging it onto another node's widget input materialises a hidden owned primitive
//   3. the primitive drives BOTH nodes
//   4. the host's dead control is covered by a surfaced editable field
//   5. typing in that field reaches the executable prompt for both consumers
//   6. it survives save/reload, and the primitive never enters the prompt

import { chromium } from 'playwright'
import fs from 'node:fs'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1700, height: 950 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph
  g.clear()
  const a = L.createNode('CLIPTextEncode'); a.pos = [120, 120]; a.title = 'A'; g.add(a)
  const b = L.createNode('CLIPTextEncode'); b.pos = [700, 120]; b.title = 'B'; g.add(b)
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 1500))
  return { a: String(a.id), b: String(b.id) }
})

// 1. pin on the unconnected `text` widget row of A
const pins = await page.evaluate(() =>
  [...document.querySelectorAll('.cablemanagement-pin')].map((p) => {
    const r = p.getBoundingClientRect()
    return { node: p.dataset.cablemanagementNode, index: p.dataset.cablemanagementIndex, kind: p.dataset.cablemanagementKind, xy: [r.x + r.width / 2, r.y + r.height / 2] }
  })
)
console.log('1. pins:', JSON.stringify(pins))
const src = pins.find((p) => p.node === ids.a && p.kind === 'widget')
if (!src) { console.log('   no widget-kind pin on A -- abort'); console.log('errors:', errs.slice(0,5)); await browser.close(); process.exit(1) }

// 2. drag it onto B's text widget input
const target = await page.evaluate((ids) => {
  const b = window.app.graph.getNodeById(Number(ids.b))
  const i = b.inputs.findIndex((s) => s.widget?.name === 'text')
  const d = document.querySelector(`[data-slot-key="${ids.b}-in-${i}"]`)
  if (!d) return null
  const r = d.getBoundingClientRect()
  return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
await page.mouse.move(src.xy[0], src.xy[1])
await page.mouse.down()
await page.mouse.move(target[0], target[1], { steps: 15 })
await page.mouse.up()
await page.waitForTimeout(1200)

const afterDrop = await page.evaluate((ids) => {
  const g = window.app.graph
  const prims = g.nodes.filter((n) => n.type === 'PrimitiveNode')
  const a = g.getNodeById(Number(ids.a)), b = g.getNodeById(Number(ids.b))
  const ti = (n) => n.inputs.findIndex((s) => s.widget?.name === 'text')
  const primEl = prims[0] ? document.querySelector(`.lg-node[data-node-id="${prims[0].id}"]`) : null
  return {
    primitiveCount: prims.length,
    owned: prims.map((p) => p.properties?.['cablemanagement.owned'] === true),
    primHiddenAttr: primEl?.dataset.cablemanagementHidden ?? null,
    primVisibility: primEl ? getComputedStyle(primEl).visibility : null,
    aTextLinked: a.inputs[ti(a)].link != null,
    bTextLinked: b.inputs[ti(b)].link != null,
    surfacedFields: document.querySelectorAll('.cablemanagement-field').length,
  }
}, ids)
console.log('2/3. after drop:', JSON.stringify(afterDrop, null, 2))

// 4/5. type into the surfaced field over A
const fieldSel = `.lg-node[data-node-id="${ids.a}"] .cablemanagement-field`
const fieldInfo = await page.evaluate((s) => {
  const f = document.querySelector(s)
  if (!f) return null
  const r = f.getBoundingClientRect()
  return { tag: f.tagName.toLowerCase(), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }
}, fieldSel)
console.log('4. surfaced field on A:', JSON.stringify(fieldInfo))

if (fieldInfo) {
  await page.click(fieldSel)
  await page.type(fieldSel, 'a cat wearing a tiny hat', { delay: 15 })
  await page.waitForTimeout(700)
}

const typed = await page.evaluate(async (ids) => {
  const g = window.app.graph
  const prim = g.nodes.find((n) => n.type === 'PrimitiveNode')
  const p = await window.app.graphToPrompt()
  return {
    fieldValue: document.querySelector(`.lg-node[data-node-id="${ids.a}"] .cablemanagement-field`)?.value,
    primitiveValue: prim?.widgets?.[0]?.value,
    aTextInPrompt: p.output[ids.a]?.inputs?.text,
    bTextInPrompt: p.output[ids.b]?.inputs?.text,
    primitiveInPrompt: Object.keys(p.output).includes(String(prim?.id)),
  }
}, ids)
console.log('5. after typing:', JSON.stringify(typed, null, 2))

// 6. save / reload
const reloaded = await page.evaluate(async (ids) => {
  const ser = JSON.parse(JSON.stringify(window.app.graph.serialize()))
  await window.app.loadGraphData(ser)
  await new Promise((r) => setTimeout(r, 1400))
  const g = window.app.graph
  const prim = g.nodes.find((n) => n.type === 'PrimitiveNode')
  const p = await window.app.graphToPrompt()
  const primEl = prim ? document.querySelector(`.lg-node[data-node-id="${prim.id}"]`) : null
  return {
    ownedFlagSurvived: prim?.properties?.['cablemanagement.owned'] === true,
    stillHidden: primEl ? getComputedStyle(primEl).visibility === 'hidden' : null,
    surfacedFields: document.querySelectorAll('.cablemanagement-field').length,
    aText: p.output[ids.a]?.inputs?.text,
    bText: p.output[ids.b]?.inputs?.text,
    primitiveInPrompt: Object.keys(p.output).includes(String(prim?.id)),
  }
}, ids)
console.log('6. after save/reload:', JSON.stringify(reloaded, null, 2))

await page.screenshot({ path: 'widget-e2e.png' })

const expect = 'a cat wearing a tiny hat'
const ok =
  !!src && afterDrop.primitiveCount === 1 && afterDrop.owned[0] === true &&
  afterDrop.primVisibility === 'hidden' && afterDrop.aTextLinked && afterDrop.bTextLinked &&
  !!fieldInfo && typed.primitiveValue === expect &&
  typed.aTextInPrompt === expect && typed.bTextInPrompt === expect && !typed.primitiveInPrompt &&
  reloaded.ownedFlagSurvived && reloaded.aText === expect && reloaded.bText === expect && !reloaded.primitiveInPrompt
console.log('\n================ VERDICT ================')
console.log(ok ? 'WIDGET PASS-THROUGH WORKS END TO END' : 'NOT working -- see above')
console.log('page errors:', errs.length); errs.slice(0, 6).forEach((e) => console.log('  ' + e.slice(0, 150)))
fs.writeFileSync('widget-e2e.json', JSON.stringify({ pins, afterDrop, fieldInfo, typed, reloaded, ok, errs }, null, 2))
await browser.close()
