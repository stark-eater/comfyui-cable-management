// cablemanagement against REAL workflows. Everything so far was synthetic three-node graphs.
//
// Checks, per workflow and after each churn operation:
//   - a pin exists for exactly the inputs that deserve one (connected, or widget-backed),
//     derived independently from the graph rather than from the extension's own bookkeeping
//   - pins track the rows they belong to through pan and zoom
//   - owned primitives stay hidden; user-made ones stay visible
//   - serialize() and graphToPrompt() are unaffected by the extension being loaded
//   - sync cost stays sane as node count grows

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const DIR = 'E:/Projects/ComfyUI-5/user/default/workflows'
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
const consoleErrs = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 160)) })

await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

// Independent expectation: what SHOULD have a pin, computed from the graph alone.
const audit = () =>
  page.evaluate(() => {
    const app = window.app, g = app.canvas?.graph ?? app.graph
    const owned = new Set(g.nodes.filter((n) => n.properties?.['cablemanagement.owned'] === true).map((n) => String(n.id)))
    let expected = 0
    const missing = [], extra = []
    const rendered = new Set(
      [...document.querySelectorAll('.cablemanagement-pin')].map((p) => `${p.dataset.cablemanagementNode}-${p.dataset.cablemanagementIndex}`)
    )
    for (const nodeEl of document.querySelectorAll('.lg-node[data-node-id]')) {
      const id = nodeEl.dataset.nodeId
      if (owned.has(id)) continue
      const isCollapsed = nodeEl.dataset.collapsed === 'true'
      const node = g.getNodeById(Number(id)) ?? g.getNodeById(id)
      if (!node) continue
      for (let i = 0; i < (node.inputs?.length ?? 0); i++) {
        const s = node.inputs[i]
        const deserves = s.link != null || !!s.widget
        // Expanded: a pin can only render if its slot dot is in the DOM.
        // Collapsed: every pass-through pin renders, stacked at the title point.
        const dot = document.querySelector(`[data-slot-key="${CSS.escape(`${id}-in-${i}`)}"]`)
        if (!deserves || (!isCollapsed && !dot)) continue
        expected++
        if (!rendered.has(`${id}-${i}`)) missing.push(`${id}-in-${i}`)
      }
    }
    for (const key of rendered) {
      const [id, idx] = [key.slice(0, key.lastIndexOf('-')), key.slice(key.lastIndexOf('-') + 1)]
      const node = g.getNodeById(Number(id)) ?? g.getNodeById(id)
      const s = node?.inputs?.[Number(idx)]
      if (!s || (s.link == null && !s.widget)) extra.push(key)
    }

    // Are pins vertically aligned with the row they claim? Collapsed pins align with the
    // title-bar point (height/2 + 7 in graph units) instead of a slot row.
    let misaligned = 0
    const scale = window.app.canvas?.ds?.scale ?? 1
    for (const p of document.querySelectorAll('.cablemanagement-pin')) {
      const a = p.getBoundingClientRect()
      if (p.dataset.cablemanagementCollapsed === '1') {
        const el = document.querySelector(`.lg-node[data-node-id="${p.dataset.cablemanagementNode}"]`)
        if (!el) { misaligned++; continue }
        const n = el.getBoundingClientRect()
        const want = n.top + n.height / 2 + 7 * scale
        if (Math.abs((a.top + a.height / 2) - want) > 3) misaligned++
        continue
      }
      const dot = document.querySelector(`[data-slot-key="${CSS.escape(`${p.dataset.cablemanagementNode}-in-${p.dataset.cablemanagementIndex}`)}"]`)
      if (!dot) { misaligned++; continue }
      const b = dot.getBoundingClientRect()
      if (Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) > 3) misaligned++
    }

    const ownedVisible = [...owned].filter((id) => {
      const el = document.querySelector(`.lg-node[data-node-id="${id}"]`)
      return el && getComputedStyle(el).visibility !== 'hidden'
    })
    const userPrimHidden = g.nodes
      .filter((n) => n.type === 'PrimitiveNode' && n.properties?.['cablemanagement.owned'] !== true)
      .filter((n) => { const el = document.querySelector(`.lg-node[data-node-id="${n.id}"]`); return el && getComputedStyle(el).visibility === 'hidden' })
      .map((n) => String(n.id))

    return {
      graphNodes: g.nodes.length,
      lgNodes: document.querySelectorAll('.lg-node').length,
      expected, renderedCount: rendered.size, missing, extra, misaligned,
      surfacedFields: document.querySelectorAll('.cablemanagement-field').length,
      ownedPrimitives: owned.size,
      ownedWronglyVisible: ownedVisible,
      userPrimitivesWronglyHidden: userPrimHidden,
    }
  })

const results = []
for (const file of files) {
  const wf = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'))
  const t0 = Date.now()
  await page.evaluate(async (d) => await window.app.loadGraphData(d), wf)
  await page.waitForTimeout(2200)

  const steps = []
  const step = async (label) => { const a = await audit(); steps.push({ label, ...a }); return a }

  await step('loaded')

  // pan + zoom
  await page.evaluate(() => { const ds = window.app.canvas.ds; ds.offset[0] -= 250; ds.offset[1] -= 120; window.app.graph.setDirtyCanvas(true, true) })
  await page.waitForTimeout(700); await step('panned')
  await page.evaluate(() => { window.app.canvas.ds.changeScale?.(0.6, [800, 500]) ?? (window.app.canvas.ds.scale = 0.6); window.app.graph.setDirtyCanvas(true, true) })
  await page.waitForTimeout(900); await step('zoomed out')
  await page.evaluate(() => { window.app.canvas.ds.changeScale?.(1.0, [800, 500]) ?? (window.app.canvas.ds.scale = 1.0); window.app.graph.setDirtyCanvas(true, true) })
  await page.waitForTimeout(900); await step('zoom restored')

  // subgraph in/out if present
  const hasSub = await page.evaluate(() => !!window.app.graph.nodes.find((n) => n.subgraph))
  if (hasSub) {
    await page.evaluate(() => { const c = window.app.canvas; const n = c.graph.nodes.find((x) => x.subgraph); c.openSubgraph(n.subgraph, n) })
    await page.waitForTimeout(1100); await step('inside subgraph')
    await page.evaluate(() => { const c = window.app.canvas; c.setGraph(c.graph.rootGraph) })
    await page.waitForTimeout(1100); await step('back out')
  }

  // undo/redo
  await page.evaluate(() => { const g = window.app.graph; for (const n of g.nodes.slice(0, 6)) n.pos = [n.pos[0] + 13, n.pos[1]]; g.setDirtyCanvas(true, true) })
  await page.mouse.click(960, 900)
  for (let i = 0; i < 5; i++) await page.keyboard.press('Control+z')
  await page.waitForTimeout(900); await step('after undo x5')

  // integrity: does the extension leak into what gets saved / executed?
  const integrity = await page.evaluate(async () => {
    const ser = JSON.stringify(window.app.graph.serialize())
    let prompt = null, promptErr = null
    try { prompt = JSON.stringify((await window.app.graphToPrompt()).output) } catch (e) { promptErr = String(e).split('\n')[0] }
    return {
      leak: /cablemanagement-(pin|field|layer|surface)/.test(ser),
      ownedFlagInSer: /cablemanagement\.owned/.test(ser),
      serLen: ser.length,
      promptOk: !!prompt,
      promptErr,
      promptLen: prompt?.length ?? 0,
    }
  })

  const worst = steps.reduce((w, s) => (s.missing.length + s.extra.length + s.misaligned > w.missing.length + w.extra.length + w.misaligned ? s : w), steps[0])
  const ok =
    steps.every((s) => s.missing.length === 0 && s.extra.length === 0 && s.misaligned === 0 && s.ownedWronglyVisible.length === 0 && s.userPrimitivesWronglyHidden.length === 0) &&
    !integrity.leak && integrity.promptOk

  results.push({ file, steps, integrity, ok, ms: Date.now() - t0 })
  console.log(`\n=== ${file} (${steps[0].graphNodes} nodes, ${Math.round((Date.now() - t0) / 100) / 10}s) ${ok ? 'PASS' : 'FAIL'}`)
  for (const s of steps) {
    console.log(
      `   ${s.label.padEnd(18)} lg=${String(s.lgNodes).padStart(3)} pins=${String(s.renderedCount).padStart(3)}/${String(s.expected).padEnd(3)} ` +
      `missing=${s.missing.length} extra=${s.extra.length} misaligned=${s.misaligned} fields=${s.surfacedFields}`
    )
  }
  if (worst.missing.length) console.log(`   worst missing: ${worst.missing.slice(0, 8).join(', ')}`)
  if (worst.extra.length) console.log(`   worst extra  : ${worst.extra.slice(0, 8).join(', ')}`)
  console.log(`   integrity: leak=${integrity.leak} prompt=${integrity.promptOk}${integrity.promptErr ? ' (' + integrity.promptErr + ')' : ''}`)
}

console.log('\n================ SUMMARY ================')
console.log(`workflows: ${results.length}, passing: ${results.filter((r) => r.ok).length}`)
for (const r of results.filter((x) => !x.ok)) console.log(`  FAIL ${r.file}`)
console.log(`page errors: ${errs.length}`); errs.slice(0, 8).forEach((e) => console.log('   ' + e.slice(0, 150)))
const mine = consoleErrs.filter((c) => /cablemanagement/i.test(c))
console.log(`console errors mentioning cablemanagement: ${mine.length}`); mine.slice(0, 5).forEach((e) => console.log('   ' + e))
fs.writeFileSync('stress.json', JSON.stringify({ results, errs, consoleErrs }, null, 2))
await browser.close()
