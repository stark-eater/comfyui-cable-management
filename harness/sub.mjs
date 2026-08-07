import { chromium } from 'playwright'
import fs from 'node:fs'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(2500)
const wf = JSON.parse(fs.readFileSync('E:/Projects/ComfyUI-5/user/default/workflows/CU5-v1-ft.json', 'utf8'))
await page.evaluate(async (d) => await window.app.loadGraphData(d), wf)
await page.waitForTimeout(2000)
await page.evaluate(() => { const c = window.app.canvas; const n = c.graph.nodes.find((x) => x.subgraph); c.openSubgraph(n.subgraph, n) })
await page.waitForTimeout(1500)
console.log(JSON.stringify(await page.evaluate(() => {
  const g = window.app.graph
  const els = [...document.querySelectorAll('.lg-node[data-node-id]')]
  return {
    appGraphIsSubgraph: !!g.isSubgraph || g.constructor?.name,
    graphNodeIds: g.nodes.map((n) => String(n.id)),
    domNodeIds: els.map((e) => e.dataset.nodeId),
    lookupWorks: els.map((e) => ({
      dom: e.dataset.nodeId,
      byNumber: !!g.getNodeById(Number(e.dataset.nodeId)),
      byRaw: !!g.getNodeById(e.dataset.nodeId),
    })),
    slotKeys: [...document.querySelectorAll('[data-slot-key]')].slice(0, 6).map((s) => s.getAttribute('data-slot-key')),
    inputsWithLinks: g.nodes.map((n) => ({ id: String(n.id), linked: (n.inputs ?? []).filter((s) => s.link != null).length, widget: (n.inputs ?? []).filter((s) => s.widget).length })),
  }
}), null, 2))
await b.close()
