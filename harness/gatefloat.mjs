// Gate-origin pin drag released on empty canvas: core has no floating form for
// io-node links -- no release menu, no reroute, no floating park; the gesture was
// swallowed with zero feedback (Barney's QA find, confirmed core behavior). The
// extension can't make it work, but it must SAY so: a warn toast fires from the
// dropOnNothing wrap, the graph stays untouched, and the connector resets clean.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagement, null, { timeout: 120_000 })
await page.waitForTimeout(2500)

// Loader -> KSampler(model), KSampler converted to a subgraph: its MODEL input is
// gate-fed inside, so its pass-through pin's origin is the input panel.
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [80, 200]; g.add(CK)
  const K = L.createNode('KSampler'); K.pos = [700, 200]; g.add(K)
  CK.connect(0, K, K.inputs.findIndex(s => s.type === 'MODEL'))
  const { subgraph } = g.convertToSubgraph(new Set([K]))
  window.app.canvas.openSubgraph(subgraph)
  await new Promise(r => setTimeout(r, 1800))
  const inner = window.app.canvas.graph.nodes.find(n => n.type === 'KSampler')
  return { inner: String(inner.id), modelIdx: inner.inputs.findIndex(s => s.type === 'MODEL') }
})
const pin = await page.evaluate(i => {
  const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
    x => x.dataset.cablemanagementNode === i.inner && x.dataset.cablemanagementIndex === String(i.modelIdx)
  )
  const r = el?.getBoundingClientRect()
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
}, ids)
ok('boundary-fed pin present', !!pin)

const before = await page.evaluate(i => {
  const g = window.app.canvas.graph
  return { links: g._links.size, floating: g.floatingLinks?.size ?? 0, modelLink: g.nodes.find(n => String(n.id) === i.inner).inputs[i.modelIdx].link }
}, ids)
await page.mouse.move(pin.x, pin.y)
await page.mouse.down()
await page.mouse.move(pin.x + 300, pin.y + 250, { steps: 10 })
await page.waitForTimeout(300)
const mid = await page.evaluate(() => ({
  io: window.app.canvas.linkConnector.renderLinks.some(rl => rl.isIoNodeLink),
}))
ok('drag carries an io-node link', mid.io)
await page.mouse.up()
await page.waitForTimeout(800)

const after = await page.evaluate(i => {
  const g = window.app.canvas.graph
  const toasts = [...document.querySelectorAll('.p-toast-message, [data-pc-name="toast"] [role="alert"]')]
  return {
    links: g._links.size, floating: g.floatingLinks?.size ?? 0,
    modelLink: g.nodes.find(n => String(n.id) === i.inner).inputs[i.modelIdx].link,
    connecting: window.app.canvas.linkConnector.isConnecting,
    searchBox: !!document.querySelector('.comfy-vue-node-search-container, [data-testid="node-search-dialog"]'),
    toastText: toasts.map(t => t.textContent).join(' | ').slice(0, 200),
  }
}, ids)
ok('warn toast shown instead of silence', after.toastText.includes("ComfyUI can't do that"), after.toastText || '(none)')
ok('graph untouched', after.links === before.links && after.floating === 0 && after.modelLink === before.modelLink)
ok('connector reset, no search box', !after.connecting && !after.searchBox)

console.log(pass ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
