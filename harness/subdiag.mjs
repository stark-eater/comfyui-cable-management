// What do connected inputs inside a subgraph look like, and which have pins?
import { chromium } from 'playwright'
import fs from 'node:fs'
const WF = process.argv[2] || 'E:/Projects/ComfyUI-5/user/default/workflows/CU5-v1-ft.json'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const wf = JSON.parse(fs.readFileSync(WF, 'utf8'))
await page.evaluate(async d => await window.app.loadGraphData(d), wf)
await page.waitForTimeout(2500)
await page.evaluate(async () => {
  const g = window.app.graph
  const sub = g.nodes.find(n => n.isSubgraphNode?.() || n.subgraph)
  window.app.canvas.openSubgraph(sub.subgraph)
  await new Promise(r => setTimeout(r, 1200))
  const gg = window.app.canvas.graph, ds = window.app.canvas.ds
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
  for (const n of gg.nodes) {
    minX = Math.min(minX, n.pos[0]); minY = Math.min(minY, n.pos[1])
    maxX = Math.max(maxX, n.pos[0] + (n.size?.[0] ?? 200)); maxY = Math.max(maxY, n.pos[1] + (n.size?.[1] ?? 100))
  }
  const scale = Math.min(1, 1800 / (maxX - minX + 200), 900 / (maxY - minY + 200))
  ds.scale = scale; ds.offset[0] = -minX + 100 / scale; ds.offset[1] = -minY + 100 / scale
  gg.setDirtyCanvas(true, true); window.dispatchEvent(new Event('resize'))
  await new Promise(r => setTimeout(r, 1500))
})
const report = await page.evaluate(() => {
  const g = window.app.canvas.graph
  const rows = []
  for (const n of g.nodes) {
    for (let i = 0; i < (n.inputs?.length ?? 0); i++) {
      const s = n.inputs[i]
      if (s.link == null) continue
      const link = g.getLink ? g.getLink(s.link) : g.links?.[s.link]
      const pin = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${n.id}"][data-cablemanagement-index="${i}"]`)
      const nodeEl = document.querySelector(`.lg-node[data-node-id="${n.id}"]`)
      rows.push({
        node: `${String(n.type).slice(0, 20)}#${n.id}`, input: s.name, type: String(s.type).slice(0, 12),
        widget: !!s.widget, linkFound: !!link, origin: link ? String(link.origin_id) : null,
        pin: !!pin, nodeElRendered: !!nodeEl,
      })
    }
  }
  return { rows, totalPins: document.querySelectorAll('.cablemanagement-pin').length, lgNodes: document.querySelectorAll('.lg-node').length, graphNodes: g.nodes.length }
})
console.log(`graph nodes: ${report.graphNodes}, lg-nodes: ${report.lgNodes}, total pins: ${report.totalPins}`)
for (const r of report.rows) {
  console.log(`  ${r.node.padEnd(24)} ${String(r.input).slice(0, 14).padEnd(14)} ${r.type.padEnd(12)} widget=${r.widget ? 1 : 0} link=${r.linkFound ? 1 : 0} origin=${String(r.origin).padEnd(4)} pin=${r.pin ? 1 : 0} el=${r.nodeElRendered ? 1 : 0}`)
}
await b.close()
