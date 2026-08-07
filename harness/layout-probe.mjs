// Can the output block be moved to the bottom of the node with CSS alone?
//
// Body is flex-col. Outputs live nested inside the first child, right-aligned via ml-auto:
//     [node-body]  flex-col
//       div.justify-between          <- inputs (left) + outputs (right)
//         div.ml-auto                <- the output column
//       .lg-node-widgets
//
// If `display:contents` on the wrapper promotes the input and output columns to body-level
// flex items, `order` should push outputs last -- no Vue patch, no DOM moves.
//
// The thing that could kill it: core derives link anchors by MEASURING slot elements. If the
// reorder moves the dots but the anchors do not follow, links detach. So measure both.

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
  const g = window.app.graph, L = window.LiteGraph
  g.clear()
  const ck = L.createNode('CheckpointLoaderSimple'); ck.pos = [80, 120]; g.add(ck)
  const te = L.createNode('CLIPTextEncode'); te.pos = [560, 120]; g.add(te)
  const ks = L.createNode('KSampler'); ks.pos = [1000, 120]; g.add(ks)
  ck.connect(1, te, 0)
  te.connect(0, ks, ks.inputs.findIndex((i) => i.name === 'positive'))
  g.setDirtyCanvas(true, true)
  await new Promise((r) => setTimeout(r, 1400))
  return { ck: String(ck.id), te: String(te.id), ks: String(ks.id) }
})

const snapshot = async (label) =>
  page.evaluate(([label, ids]) => {
    const rect = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }
    const node = (id) => rect(`.lg-node[data-node-id="${id}"]`)
    const slot = (k) => rect(`[data-slot-key="${k}"]`)
    // Where does core THINK the slot is? That is what links are drawn from.
    const anchor = (id, kind, i) => {
      const n = window.app.graph.getNodeById(Number(id))
      if (!n) return null
      const p = kind === 'out' ? n.getOutputPos?.(i) : n.getInputPos?.(i)
      return p ? [Math.round(p[0]), Math.round(p[1])] : null
    }
    return {
      label,
      teNode: node(ids.te),
      teIn0: slot(`${ids.te}-in-0`),
      teOut0: slot(`${ids.te}-out-0`),
      teOut0Anchor: anchor(ids.te, 'out', 0),
      teIn0Anchor: anchor(ids.te, 'in', 0),
      ksNode: node(ids.ks),
      ksIn0: slot(`${ids.ks}-in-0`),
      ksIn0Anchor: anchor(ids.ks, 'in', 0),
      liteSize: (() => { const n = window.app.graph.getNodeById(Number(ids.te)); return n ? [Math.round(n.size[0]), Math.round(n.size[1])] : null })(),
    }
  }, [label, setup])

const before = await snapshot('before')

// Extension now owns this; just toggle its class.
await page.evaluate(() => { document.body.classList.add("cablemanagement-layout") }); if (false) await page.evaluate(() => {
  const css = `
    .lg-node [data-testid^="node-body-"] > div:has(> .ml-auto) { display: contents; }
    .lg-node [data-testid^="node-body-"] > div > .ml-auto { order: 99; }
  `
  const style = document.createElement('style')
  style.id = 'cablemanagement-layout-probe'
  style.appendChild(document.createTextNode(css))
  document.head.appendChild(style)
})
await page.waitForTimeout(1200)
const after = await snapshot('after CSS')

// Force a re-render / node move and re-measure, to see whether core re-measures anchors.
await page.evaluate((ids) => {
  const n = window.app.graph.getNodeById(Number(ids.te))
  n.pos = [n.pos[0] + 3, n.pos[1]]
  window.app.graph.setDirtyCanvas(true, true)
}, setup)
await page.waitForTimeout(1000)
const afterNudge = await snapshot('after nudge')

for (const s of [before, after, afterNudge]) {
  console.log(`\n=== ${s.label} ===`)
  console.log(`  CLIPTextEncode node rect : ${JSON.stringify(s.teNode)}   litegraph size: ${JSON.stringify(s.liteSize)}`)
  console.log(`  in-0  dot ${JSON.stringify(s.teIn0)}  anchor(graph-space) ${JSON.stringify(s.teIn0Anchor)}`)
  console.log(`  out-0 dot ${JSON.stringify(s.teOut0)}  anchor(graph-space) ${JSON.stringify(s.teOut0Anchor)}`)
}

// Did the output dot actually move BELOW the input dot?
const moved = after.teOut0 && before.teOut0 && after.teOut0[1] > before.teOut0[1]
const stillMeasurable = !!after.teOut0 && after.teOut0[2] > 0
console.log(`\noutput dot moved down: ${moved}   (before y=${before.teOut0?.[1]} after y=${after.teOut0?.[1]})`)
console.log(`output dot still measurable: ${stillMeasurable}`)
console.log(`litegraph size changed: ${JSON.stringify(before.liteSize)} -> ${JSON.stringify(afterNudge.liteSize)}`)

await page.screenshot({ path: 'layout-probe.png' })
console.log('\nwrote layout-probe.png')
console.log('page errors:', errs.length); errs.slice(0, 5).forEach((e) => console.log('  ' + e.slice(0, 140)))
fs.writeFileSync('layout-probe.json', JSON.stringify({ before, after, afterNudge, errs }, null, 2))
await browser.close()
