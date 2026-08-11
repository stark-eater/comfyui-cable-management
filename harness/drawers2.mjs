// (1) Collapsed output drawer with ZERO visible rows: the ellipsis must sit in the outputs
//     block (above NodeBadges), held open by the column's reserved min-height.
// (2) True refresh persistence: toggle -> wait out the persist debounce -> reload and let
//     Comfy's own draft restore run (no loadGraphData) -> drawer still collapsed.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1400, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [120, 120]; g.add(CK) // outputs all unconnected
  const K = L.createNode('KSampler'); K.pos = [640, 120]; g.add(K)
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return { CK: String(CK.id), K: String(K.id) }
})
// Collapse CK's outputs (all unconnected -> empty drawer).
await page.evaluate(i => document.querySelector(`.lg-node[data-node-id="${i.CK}"] .cablemanagement-collapse[data-which="outputs"]`)?.click(), ids)
await page.waitForTimeout(700)
const empty = await page.evaluate(i => {
  const el = document.querySelector(`.lg-node[data-node-id="${i.CK}"]`)
  const more = el.querySelector('.cablemanagement-more[data-which="outputs"]')
  const col = el.querySelector('[data-testid^="node-body-"] > div > .ml-auto')
  const badge = el.querySelector('[data-testid^="node-body-"] > .mt-auto')
  const nr = el.getBoundingClientRect()
  const mr = more?.getBoundingClientRect(), cr = col?.getBoundingClientRect(), br = badge?.getBoundingClientRect()
  return {
    more: !!more, colH: cr ? Math.round(cr.height) : null,
    moreTop: mr ? Math.round(mr.top - nr.top) : null,
    colTop: cr ? Math.round(cr.top - nr.top) : null,
    colBottom: cr ? Math.round(cr.bottom - nr.top) : null,
    badgeTop: br ? Math.round(br.top - nr.top) : null,
    isModified: window.app.extensionManager?.workflow?.activeWorkflow?.isModified ?? null,
  }
}, ids)
console.log('empty-outputs:', JSON.stringify(empty))
const inCol = empty.more && empty.colTop != null && empty.moreTop >= empty.colTop - 2 && empty.moreTop <= empty.colBottom + 2
const aboveBadge = empty.badgeTop == null || empty.moreTop < empty.badgeTop

// Also collapse KSampler's outputs for the refresh test (its inputs are all REQUIRED
// now, so the inputs block has nothing to hide and grows no caret).
await page.evaluate(i => document.querySelector(`.lg-node[data-node-id="${i.K}"] .cablemanagement-collapse[data-which="outputs"]`)?.click(), ids)
// Let the debounced draft persist fire.
await page.waitForTimeout(2500)

// Reload; DO NOT loadGraphData -- Comfy restores the draft itself.
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(4000)
const restored = await page.evaluate(({ CK, K }) => {
  const g = window.app.graph
  const ck = g.getNodeById(Number(CK)), k = g.getNodeById(Number(K))
  const ckEl = ck && document.querySelector(`.lg-node[data-node-id="${ck.id}"]`)
  const kEl = k && document.querySelector(`.lg-node[data-node-id="${k.id}"]`)
  return {
    nodes: g.nodes.length,
    ckProp: ck?.properties?.['cablemanagement.drawers'] ?? null,
    kProp: k?.properties?.['cablemanagement.drawers'] ?? null,
    ckState: ckEl?.dataset.cablemanagementOutputs ?? null,
    kState: kEl?.dataset.cablemanagementOutputs ?? null,
    kMore: !!kEl?.querySelector('.cablemanagement-more[data-which="outputs"]'),
  }
}, ids)
console.log('after refresh:', JSON.stringify(restored))
const pass = inCol && aboveBadge && empty.colH >= 12 &&
  restored.ckProp?.outputs === true && restored.kProp?.outputs === true &&
  restored.ckState === 'collapsed' && restored.kState === 'collapsed' && restored.kMore
console.log('empty-placement:', inCol && aboveBadge ? 'PASS' : 'FAIL', '| refresh-restore:', restored.kState === 'collapsed' ? 'PASS' : 'FAIL')
console.log(pass ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
