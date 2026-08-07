// UI-RESEARCH.md 10.1 -- does the Vue-mixin render patch survive real workflow churn?
//
// Asserts after every churn operation that the patch still reaches every rendered node.
//   renderStamped == lgNodes  -> the type-level setup patch covers every instance
//   mountStamped  == lgNodes  -> the per-instance mixin hook covers every instance
// A persistent shortfall in renderStamped is the documented "one instance escapes" problem;
// a shortfall that GROWS after an operation means the patch is being lost, which would kill
// items 1, 2 and part of 7 of the spec.

import { chromium } from 'playwright'
import fs from 'node:fs'

const URL = process.env.COMFY_URL ?? 'http://127.0.0.1:8187'
const WF = process.argv[2] || 'E:/Projects/ComfyUI-5/user/default/workflows/CU5-v1-ft.json'
const HEADLESS = process.env.HEADED !== '1'

const rows = []
const pageErrors = []

const browser = await chromium.launch({ headless: HEADLESS })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })

page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]))
page.on('console', (m) => {
  const t = m.text()
  if (t.includes('[probe]') || m.type() === 'error') {
    console.log(`  console.${m.type()}: ${t.slice(0, 200)}`)
  }
})

console.log(`goto ${URL}`)
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90_000 })

console.log('waiting for app + probe...')
await page.waitForFunction(() => window.__probe && window.app && window.app.graph, null, {
  timeout: 120_000,
})
// let the default graph settle
await page.waitForTimeout(3000)

async function check(label) {
  await page.waitForTimeout(700)
  const c = await page.evaluate(() => window.__probe.counts())
  const ok = c.lgNodes > 0 && c.renderStamped === c.lgNodes && c.mountStamped === c.lgNodes
  rows.push({ label, ...c, ok })
  const gapR = c.lgNodes - c.renderStamped
  const gapM = c.lgNodes - c.mountStamped
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'} ${label.padEnd(34)} ` +
      `lg=${String(c.lgNodes).padStart(3)} render=${String(c.renderStamped).padStart(3)}(${gapR >= 0 ? '-' : '+'}${Math.abs(gapR)}) ` +
      `mount=${String(c.mountStamped).padStart(3)}(${gapM >= 0 ? '-' : '+'}${Math.abs(gapM)}) ` +
      `graphNodes=${c.graphNodes}`
  )
  if (c.errors.length) console.log('    probe errors:', c.errors.slice(0, 3))
  return c
}

const first = await check('00 boot (default graph)')
console.log('  vueNodesEnabled =', first.vueNodesEnabled, '| patchedTypes =', first.patchedTypes)
if (!first.vueNodesEnabled) {
  console.log('\n!! Comfy.VueNodes.Enabled is FALSE in this browser profile.')
  console.log('!! Nodes 2.0 is off, so .lg-node will not exist. Enabling and reloading.\n')
  await page.evaluate(async () => {
    await window.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', true)
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__probe && window.app && window.app.graph, null, {
    timeout: 120_000,
  })
  await page.waitForTimeout(3000)
  await check('00b boot after enabling Nodes 2.0')
}

// ---- load a real, subgraph-heavy workflow -------------------------------------------
const wf = JSON.parse(fs.readFileSync(WF, 'utf8'))
console.log(`\nloading workflow ${WF.split('/').pop()} (${wf.nodes.length} top-level nodes)`)
await page.evaluate(async (data) => {
  await window.app.loadGraphData(data)
}, wf)
await check('01 workflow loaded')

// ---- subgraph enter / exit x3 -------------------------------------------------------
for (let i = 1; i <= 3; i++) {
  const entered = await page.evaluate(() => {
    const c = window.app.canvas
    const n = c.graph.nodes.find((n) => n.subgraph)
    if (!n) return 'no subgraph node found'
    c.openSubgraph(n.subgraph, n)
    return n.title || n.type
  })
  await check(`02.${i} entered subgraph`)
  await page.evaluate(() => {
    const c = window.app.canvas
    c.setGraph(c.graph.rootGraph)
  })
  await check(`03.${i} exited subgraph  [${String(entered).slice(0, 12)}]`)
}

// ---- undo / redo x10 ----------------------------------------------------------------
// Make a real mutation first so there is history to walk.
await page.evaluate(() => {
  const c = window.app.canvas
  for (const n of c.graph.nodes.slice(0, 10)) n.pos = [n.pos[0] + 17, n.pos[1] + 11]
  c.graph.setDirtyCanvas(true, true)
})
await page.mouse.click(960, 700)
await check('04 pre-undo mutation')

for (let i = 0; i < 10; i++) await page.keyboard.press('Control+z')
await check('05 after 10x undo')
for (let i = 0; i < 10; i++) await page.keyboard.press('Control+y')
await check('06 after 10x redo')

// ---- paste a node group -------------------------------------------------------------
const pasted = await page.evaluate(() => {
  const c = window.app.canvas
  try {
    const nodes = c.graph.nodes.slice(0, 4)
    if (!nodes.length) return 'no nodes'
    c.selectItems ? c.selectItems(nodes) : nodes.forEach((n) => c.selectNode(n, true))
    c.copyToClipboard()
    c.pasteFromClipboard({ connectInputs: false })
    return `pasted ${nodes.length}`
  } catch (e) {
    return 'ERR ' + String(e).split('\n')[0]
  }
})
await check(`07 paste group [${pasted}]`)

// ---- refresh node definitions -------------------------------------------------------
const refreshed = await page.evaluate(async () => {
  try {
    await window.app.refreshComboInNodes()
    return 'ok'
  } catch (e) {
    return 'ERR ' + String(e).split('\n')[0]
  }
})
await check(`08 refreshComboInNodes [${refreshed}]`)

// ---- reload the page with the workflow in place -------------------------------------
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__probe && window.app && window.app.graph, null, {
  timeout: 120_000,
})
await page.waitForTimeout(3500)
await check('09 after full page reload')

// ---- serialisation integrity --------------------------------------------------------
const ser = await page.evaluate(() => window.__probe.serialize())
const prompt = await page.evaluate(() => window.__probe.prompt().catch((e) => 'ERR ' + e))
const leak = /probe|cablemanagement/i.test(ser)
console.log(`\nserialize(): ${ser.length} chars, probe-attr leak = ${leak ? 'YES -- BAD' : 'no'}`)
console.log(`graphToPrompt(): ${String(prompt).slice(0, 60)}... (${String(prompt).length} chars)`)

// ---- verdict ------------------------------------------------------------------------
console.log('\n================ VERDICT ================')
const failures = rows.filter((r) => !r.ok)
const renderGaps = rows.map((r) => r.lgNodes - r.renderStamped)
const mountGaps = rows.map((r) => r.lgNodes - r.mountStamped)
console.log(`checks: ${rows.length}, failing: ${failures.length}`)
console.log(`render gap: min=${Math.min(...renderGaps)} max=${Math.max(...renderGaps)}`)
console.log(`mount  gap: min=${Math.min(...mountGaps)} max=${Math.max(...mountGaps)}`)
console.log(`page errors: ${pageErrors.length}`)
pageErrors.slice(0, 8).forEach((e) => console.log('  ' + e.slice(0, 160)))
if (failures.length) {
  console.log('\nfailing steps:')
  failures.forEach((f) =>
    console.log(`  ${f.label}: lg=${f.lgNodes} render=${f.renderStamped} mount=${f.mountStamped}`)
  )
}
fs.writeFileSync('s10-1-results.json', JSON.stringify({ rows, pageErrors, leak }, null, 2))
console.log('\nwrote s10-1-results.json')

await browser.close()
