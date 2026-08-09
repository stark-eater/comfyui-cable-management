// Unpack mechanism probe: what exactly does convertToSubgraph -> unpackSubgraph
// do to a pass-through chain? Phases measured: built / converted (subgraph
// interior + parent) / unpacked SYNCHRONOUSLY (same task, before the extension's
// rAF sync can reap anything) / settled (after the sync pass ran).
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })

async function drag(page, from, to) {
  await page.mouse.move(...from); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(250)
  await page.mouse.up(); await page.waitForTimeout(900)
}
const pinPos = (page, id, kind, idx) => page.evaluate(({ id, kind, idx }) => {
  const sel = idx != null
    ? `.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-index="${idx}"]`
    : `.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-kind="${kind}"]`
  const p = document.querySelector(sel)
  if (!p) return null
  const r = p.getBoundingClientRect(); return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, kind, idx })
const dotPos = (page, id, idx) => page.evaluate(({ id, idx }) => {
  const d = document.querySelector(`[data-slot-key="${id}-in-${idx}"]`)
  if (!d) return null
  const r = d.getBoundingClientRect(); return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx })

async function run(flavour) {
  const page = await b.newPage({ viewport: { width: 2100, height: 1000 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
  await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForFunction(() => window.app?.graph && window.__cablemanagement, null, { timeout: 120_000 })
  await page.waitForTimeout(2600)

  const ids = await page.evaluate(async ({ flavour }) => {
    const g = window.app.graph, L = window.LiteGraph; g.clear()
    const out = {}
    const A = L.createNode('CLIPTextEncode'); A.pos = [440, 80]; A.title = 'A'; g.add(A); out.A = String(A.id)
    const B = L.createNode('CLIPTextEncode'); B.pos = [980, 80]; B.title = 'B'; g.add(B); out.B = String(B.id)
    const C = L.createNode('CLIPTextEncode'); C.pos = [980, 500]; C.title = 'C'; g.add(C); out.C = String(C.id)
    if (flavour === 'link') {
      const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [30, 60]; g.add(CK); out.O = String(CK.id)
      out.idx = A.inputs.findIndex((s) => s.type === 'CLIP')
      CK.connect(1, A, out.idx)
    } else {
      A.widgets.find((w) => w.name === 'text').value = 'chain value'
      out.idx = A.inputs.findIndex((s) => s.widget?.name === 'text')
    }
    g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
    return out
  }, { flavour })
  const idxOf = (id) => page.evaluate(({ id, flavour }) => {
    const n = window.app.graph.getNodeById(Number(id))
    return flavour === 'link' ? n.inputs.findIndex((s) => s.type === 'CLIP') : n.inputs.findIndex((s) => s.widget?.name === 'text')
  }, { id, flavour })
  const bIdx = await idxOf(ids.B)
  await drag(page, await pinPos(page, ids.A, flavour === 'link' ? 'link' : 'widget', null), await dotPos(page, ids.B, bIdx))
  const cIdx = await idxOf(ids.C)
  await drag(page, await pinPos(page, ids.B, null, bIdx), await dotPos(page, ids.C, cIdx))

  // Convert, snapshot, unpack, snapshot -- all in ONE evaluate so the extension's
  // rAF-deferred sync cannot run between the unpack and the sync snapshot.
  const report = await page.evaluate(async ({ ids, flavour }) => {
    const g = window.app.graph
    const dump = (graph) => ({
      nodes: (graph.nodes ?? []).map((n) => `${n.title ?? n.type}#${n.id}${n.properties?.['cablemanagement.owned'] ? '(owned)' : ''}`),
      links: [...(graph._links?.values?.() ?? [])].map((l) => `${l.id}:${l.origin_id}[${l.origin_slot}]->${l.target_id}[${l.target_slot}]`),
      floating: [...(graph.floatingLinks?.values?.() ?? [])].length,
      prov: (graph.nodes ?? []).filter((n) => n.properties?.['cablemanagement.from'])
        .map((n) => `${n.title}#${n.id}:${JSON.stringify(n.properties['cablemanagement.from'])}`),
      extraKeys: Object.keys(graph.extra ?? {}).filter((k) => /cablemanagement/.test(k)),
    })
    const built = dump(g)

    const pick = ['A', 'B', 'C'].map((t) => g.getNodeById(Number(ids[t]))).filter(Boolean)
    const prims = g.nodes.filter((n) => n.type === 'PrimitiveNode')
    const { subgraph, node } = g.convertToSubgraph(new Set([...pick, ...prims]))
    const converted = { parent: dump(g), inside: dump(subgraph), subgraphNodeId: String(node.id) }

    g.unpackSubgraph(node)
    const unpackedSync = dump(g)

    await new Promise((r) => setTimeout(r, 1500))
    const settled = dump(g)
    return { built, converted, unpackedSync, settled }
  }, { ids, flavour })

  console.log(`\n======== ${flavour} ========`)
  for (const [phase, d] of Object.entries(report)) {
    console.log(`-- ${phase}: ${JSON.stringify(d, null, 1)}`)
  }
  if (errs.length) console.log('pageerrors:', errs.slice(0, 4))
  await page.close()
}

await run('widget')
await run('link')
await b.close()
