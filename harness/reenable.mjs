// If an owned primitive is hidden, the user must still be able to type the value on the
// host. The host's control goes `disabled` when its input is linked. Can we simply
// re-enable it, does the edit reach us, and does Vue put `disabled` back on re-render?

import { chromium } from 'playwright'
import fs from 'node:fs'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1700, height: 950 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

const setup = await page.evaluate(async () => {
  const app = window.app, LiteGraph = window.LiteGraph, g = app.graph
  g.clear()
  const host = LiteGraph.createNode('CLIPTextEncode'); host.pos = [600, 150]; g.add(host)
  await new Promise((r) => setTimeout(r, 700))
  const idx = host.inputs.findIndex((i) => i.widget?.name === 'text')
  const prim = LiteGraph.createNode('PrimitiveNode'); prim.pos = [host.pos[0] + 10, host.pos[1] + 10]; g.add(prim)
  prim.properties['cablemanagement.owned'] = true
  prim.connect(0, host, idx)
  if (prim.widgets?.[0]) { prim.widgets[0].value = 'seeded from primitive'; prim.widgets[0].callback?.('seeded from primitive') }
  // hide it the way the extension does
  await new Promise((r) => setTimeout(r, 800))
  const el = document.querySelector(`.lg-node[data-node-id="${prim.id}"]`)
  if (el) { el.style.visibility = 'hidden'; el.style.pointerEvents = 'none' }
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 500))
  return { hostId: String(host.id), primId: String(prim.id), idx }
})

const sel = `.lg-node[data-node-id="${setup.hostId}"] textarea`

// 1. re-enable
const reenabled = await page.evaluate((sel) => {
  const ta = document.querySelector(sel)
  if (!ta) return { found: false }
  ta.disabled = false
  ta.removeAttribute('disabled')
  return { found: true, disabledNow: ta.disabled, value: ta.value }
}, sel)
console.log('1. re-enable:', JSON.stringify(reenabled))

// 2. can we type into it, and does an input event carry the text?
await page.click(sel, { timeout: 5000 }).catch((e) => console.log('   click failed:', String(e).split('\n')[0]))
await page.type(sel, ' EDITED', { delay: 20 }).catch((e) => console.log('   type failed:', String(e).split('\n')[0]))
await page.waitForTimeout(600)

const afterType = await page.evaluate(([sel, ids]) => {
  const ta = document.querySelector(sel)
  const g = window.app.graph
  const host = g.getNodeById(Number(ids.hostId))
  const prim = g.getNodeById(Number(ids.primId))
  return {
    domValue: ta?.value,
    stillEnabled: ta ? !ta.disabled : null,
    hostWidgetValue: host?.widgets?.find((w) => w.name === 'text')?.value,
    primitiveValue: prim?.widgets?.[0]?.value,
  }
}, [sel, setup])
console.log('2. after typing:', JSON.stringify(afterType, null, 2))

// 3. does Vue re-apply `disabled` after a re-render is forced?
await page.evaluate(() => {
  window.app.graph.setDirtyCanvas(true, true)
  const n = window.app.graph.nodes[0]
  n.pos = [n.pos[0] + 25, n.pos[1]]
  window.app.graph.setDirtyCanvas(true, true)
})
await page.waitForTimeout(1200)
const afterRerender = await page.evaluate((sel) => {
  const ta = document.querySelector(sel)
  return { present: !!ta, disabled: ta ? ta.disabled : null, value: ta?.value }
}, sel)
console.log('3. after forced re-render:', JSON.stringify(afterRerender))

// 4. what actually reaches the prompt?
const prompt = await page.evaluate(async (ids) => {
  const p = await window.app.graphToPrompt()
  return { hostText: p.output[ids.hostId]?.inputs?.text, primitiveInPrompt: Object.keys(p.output).includes(ids.primId) }
}, setup)
console.log('4. prompt:', JSON.stringify(prompt))

console.log('\npage errors:', errs.length); errs.slice(0, 5).forEach((e) => console.log('  ' + e.slice(0, 140)))
fs.writeFileSync('reenable.json', JSON.stringify({ setup, reenabled, afterType, afterRerender, prompt, errs }, null, 2))
await browser.close()
