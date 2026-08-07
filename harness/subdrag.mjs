// Inside a subgraph: can a pass-through pin whose origin is the BOUNDARY (-10) start a drag?
// Also dump what DOM the subgraph IO node renders per slot, to find a forwarding target.
import { chromium } from 'playwright'
import fs from 'node:fs'
const WF = process.argv[2] || 'E:/Projects/ComfyUI-5/user/default/workflows/CU5-v1-ft.json'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const wf = JSON.parse(fs.readFileSync(WF, 'utf8'))
await page.evaluate(async d => await window.app.loadGraphData(d), wf)
await page.waitForTimeout(2500)
const entered = await page.evaluate(async () => {
  const g = window.app.graph
  const sub = g.nodes.find(n => n.isSubgraphNode?.() || n.subgraph)
  if (!sub) return null
  window.app.canvas.openSubgraph(sub.subgraph)
  await new Promise(r => setTimeout(r, 1500))
  return String(sub.id)
})
console.log('entered subgraph of node:', entered)
// Frame the subgraph contents: Vue only renders on-screen nodes, so pins for off-screen
// nodes do not exist at all.
await page.evaluate(async () => {
  const g = window.app.canvas.graph, ds = window.app.canvas.ds
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
  for (const n of g.nodes) {
    minX = Math.min(minX, n.pos[0]); minY = Math.min(minY, n.pos[1])
    maxX = Math.max(maxX, n.pos[0] + (n.size?.[0] ?? 200)); maxY = Math.max(maxY, n.pos[1] + (n.size?.[1] ?? 100))
  }
  const scale = Math.min(1, 1800 / (maxX - minX + 200), 900 / (maxY - minY + 200))
  ds.scale = scale
  ds.offset[0] = -minX + 100 / scale
  ds.offset[1] = -minY + 100 / scale
  g.setDirtyCanvas(true, true)
  window.dispatchEvent(new Event('resize'))
  await new Promise(r => setTimeout(r, 1200))
})
const info = await page.evaluate(() => {
  const g = window.app.canvas.graph
  // pins whose input is fed from the boundary
  const boundary = []
  for (const p of document.querySelectorAll('.cablemanagement-pin[data-cablemanagement-kind="link"]')) {
    const host = g.getNodeById(Number(p.dataset.cablemanagementNode))
    const slot = host?.inputs?.[Number(p.dataset.cablemanagementIndex)]
    const link = slot?.link != null ? g.getLink(slot.link) : null
    if (!link || Number(link.origin_id) !== -10) continue
    const r = p.getBoundingClientRect()
    boundary.push({ host: String(host.id), idx: Number(p.dataset.cablemanagementIndex), type: String(slot.type), originSlot: link.origin_slot, pin: [r.x + r.width / 2, r.y + r.height / 2], vis: !!r.width })
  }
  // what DOM does the IO node render? look for anything data-ish near the input node
  const ioEls = [...document.querySelectorAll('[data-slot-key^="-10"], [class*="subgraph" i], [data-testid*="subgraph" i]')].slice(0, 8)
    .map(el => `${el.tagName}.${String(el.className).slice(0, 60)} slotKey=${el.dataset?.slotKey} testid=${el.dataset?.testid}`)
  const ioNode = g.inputNode
  return { boundaryPins: boundary.slice(0, 6), ioEls, ioNodePos: ioNode?.pos ? [...ioNode.pos] : null, ioSlots: ioNode?.slots?.map(s => s.name) ?? null }
})
console.log('boundary-fed pins:', JSON.stringify(info.boundaryPins, null, 1))
console.log('io-ish elements:', info.ioEls)
console.log('ioNode pos:', info.ioNodePos, 'slots:', info.ioSlots)
// Try each boundary pin until one has a compatible target elsewhere
let c = null, tgtFound = null
for (const cand of info.boundaryPins.filter(p => p.vis)) {
  const t = await page.evaluate(({ c }) => {
    const g = window.app.canvas.graph
    for (const pass of [true, false]) { // unconnected targets first, then allow replace
      for (const n of g.nodes) {
        if (String(n.id) === c.host) continue
        for (let i = 0; i < (n.inputs?.length ?? 0); i++) {
          const s = n.inputs[i]
          if (s.widget || String(s.type) !== c.type) continue
          if (pass && s.link != null) continue
          const d = document.querySelector(`[data-slot-key="${n.id}-in-${i}"]`)
          const r = d?.getBoundingClientRect()
          if (r?.width && r.x > 0 && r.y > 0 && r.x < 1880 && r.y < 980) return { xy: [r.x + r.width / 2, r.y + r.height / 2], id: String(n.id), idx: i }
        }
      }
    }
    return null
  }, { c: cand })
  if (t) { c = cand; tgtFound = t; break }
}
if (c) {
  const tgt = tgtFound
  console.log('drag attempt:', JSON.stringify(c), '->', JSON.stringify(tgt))
  if (tgt) {
    await page.mouse.move(...c.pin); await page.mouse.down()
    await page.mouse.move(tgt.xy[0], tgt.xy[1], { steps: 12 }); await page.waitForTimeout(250)
    const mid = await page.evaluate(() => window.app.canvas?.linkConnector?.renderLinks?.length ?? 0)
    await page.mouse.up(); await page.waitForTimeout(800)
    const got = await page.evaluate(({ tgt }) => {
      const g = window.app.canvas.graph, n = g.getNodeById(Number(tgt.id))
      const l = n?.inputs?.[tgt.idx]?.link != null ? g.getLink(n.inputs[tgt.idx].link) : null
      return l ? String(l.origin_id) : null
    }, { tgt })
    console.log(`mid renderLinks=${mid} after origin=${got} (want -10)`)
    console.log(Number(got) === -10 ? 'PASS' : 'FAIL (boundary drag dead)')
  }
} else console.log('no visible boundary pins to try')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
