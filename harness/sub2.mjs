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
  const g = window.app.canvas.graph
  const rendered = new Set([...document.querySelectorAll('.cablemanagement-pin')].map((p) => `${p.dataset.cablemanagementNode}-${p.dataset.cablemanagementIndex}`))
  const unresolved = []
  for (const n of g.nodes) {
    for (let i = 0; i < (n.inputs ?? []).length; i++) {
      const s = n.inputs[i]
      if (s.link == null) continue
      if (rendered.has(`${n.id}-${i}`)) continue
      const link = g.getLink ? g.getLink(s.link) : g.links?.[s.link]
      const origin = link ? g.getNodeById(link.origin_id) : null
      unresolved.push({
        node: String(n.id), type: n.type, input: s.name, linkId: s.link,
        linkResolved: !!link,
        originId: link ? String(link.origin_id) : null,
        originFound: !!origin,
        originType: origin?.type ?? null,
      })
    }
  }
  return {
    graphKind: g.constructor?.name,
    isSubgraph: !!g.isRootGraph === false,
    hasInputNode: !!g.inputNode, inputNodeId: g.inputNode ? String(g.inputNode.id) : null,
    hasOutputNode: !!g.outputNode, outputNodeId: g.outputNode ? String(g.outputNode.id) : null,
    graphNodeIds: g.nodes.map((n) => String(n.id)),
    unresolved,
  }
}), null, 2))
await b.close()
