// With the inputs drawer collapsed: widget rows keep their hover input dots, and our
// widget pass-through pins sit on their rows' true (post-gap) positions.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1400, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [80, 100]; g.add(CK)
  const K = L.createNode('KSampler'); K.pos = [560, 100]; g.add(K)
  CK.connect(0, K, K.inputs.findIndex(s => s.type === 'MODEL'))
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return { K: String(K.id), seedIdx: K.inputs.findIndex(s => s.widget?.name === 'seed') }
})
await page.evaluate(i => document.querySelector(`.lg-node[data-node-id="${i.K}"] .cablemanagement-collapse[data-which="inputs"]`)?.click(), ids)
await page.waitForTimeout(900)

const state = await page.evaluate(i => {
  const el = document.querySelector(`.lg-node[data-node-id="${i.K}"]`)
  const seedDot = document.querySelector(`[data-slot-key="${i.K}-in-${i.seedIdx}"]`)
  const innerSlot = seedDot?.closest('.lg-slot')
  const widgetRow = seedDot?.closest('.lg-node-widget')
  const pin = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${i.K}"][data-cablemanagement-index="${i.seedIdx}"]`)
  const standalone = [...el.querySelectorAll('[data-testid^="node-body-"] > div > div:not(.ml-auto) > .lg-slot--input')]
  const dotR = seedDot?.getBoundingClientRect(), pinR = pin?.getBoundingClientRect()
  return {
    drawer: el.dataset.cablemanagementInputs,
    innerSlotH: innerSlot ? Math.round(innerSlot.getBoundingClientRect().height) : null,
    innerMarked: innerSlot?.dataset.cablemanagementLinked ?? null,
    widgetRowMarked: widgetRow?.dataset.cablemanagementLinked ?? null,
    hiddenStandalone: standalone.filter(r => r.getBoundingClientRect().height < 1).length,
    pinDy: dotR && pinR ? Math.round((pinR.y + pinR.height / 2) - (dotR.y + dotR.height / 2)) : null,
    more: !!el.querySelector('.cablemanagement-more[data-which="inputs"]'),
  }
}, ids)
console.log('state:', JSON.stringify(state))

// Hover the seed row: the in-widget dot container must become visible.
const hover = await page.evaluate(i => {
  const d = document.querySelector(`[data-slot-key="${i.K}-in-${i.seedIdx}"]`)
  const r = d.closest('.lg-node-widget').getBoundingClientRect()
  return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
await page.mouse.move(...hover)
await page.waitForTimeout(400)
const hovered = await page.evaluate(i => {
  const d = document.querySelector(`[data-slot-key="${i.K}-in-${i.seedIdx}"]`)
  const container = d.closest('.lg-node-widget').querySelector('.z-10')
  const dotR = d.getBoundingClientRect()
  return {
    containerOpacity: container ? getComputedStyle(container).opacity : null,
    dotVisibleBox: dotR.width > 2 && dotR.height > 2,
  }
}, ids)
console.log('hovered:', JSON.stringify(hovered))
const pass = state.drawer === 'collapsed' && state.hiddenStandalone >= 3 && state.more &&
  state.innerSlotH > 5 && state.innerMarked === null &&
  Math.abs(state.pinDy ?? 99) <= 2 &&
  Number(hovered.containerOpacity) > 0.5 && hovered.dotVisibleBox
console.log(pass ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
