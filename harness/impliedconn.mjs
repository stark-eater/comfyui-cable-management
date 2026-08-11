// Implied connections on drawer-collapsed nodes: dropping a link on the node body must
// still offer/connect to the first free compatible input, even though that input's row is
// hidden by the collapsed drawer. Requires hidden rows to stay mounted (zero-height, not
// display:none) so the layout store keeps them as candidates. Only unlinked OPTIONAL
// inputs hide (required rows stay visible), so the hidden candidate here is
// LatentCompositeMasked's optional mask.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
  const E = L.createNode('EmptyLatentImage'); E.pos = [60, 60]; g.add(E)
  const SM = L.createNode('SolidMask'); SM.pos = [60, 420]; g.add(SM)
  const LCM = L.createNode('LatentCompositeMasked'); LCM.pos = [640, 120]; g.add(LCM)
  E.connect(0, LCM, LCM.inputs.findIndex(s => s.name === 'destination'))
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return { E: String(E.id), SM: String(SM.id), LCM: String(LCM.id), maskIdx: LCM.inputs.findIndex(s => s.name === 'mask') }
})
// Collapse LCM's inputs drawer -- folds exactly the unlinked optional mask row.
await page.evaluate(i => document.querySelector(`.lg-node[data-node-id="${i.LCM}"] .cablemanagement-collapse[data-which="inputs"]`)?.click(), ids)
await page.waitForTimeout(800)
const collapsedState = await page.evaluate(i => {
  const el = document.querySelector(`.lg-node[data-node-id="${i.LCM}"]`)
  const rows = [...el.querySelectorAll('.lg-slot--input')]
  const hidden = rows.filter(r => r.getBoundingClientRect().height < 1)
  return { total: rows.length, hidden: hidden.length, nodeH: Math.round(el.getBoundingClientRect().height), state: el.dataset.cablemanagementInputs }
}, ids)
console.log('collapsed:', JSON.stringify(collapsedState))

// Drag SolidMask's MASK output onto LCM's HEADER (node body, not any slot).
const from = await page.evaluate(i => {
  const d = document.querySelector(`[data-slot-key="${i.SM}-out-0"]`)
  const r = d.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
}, ids)
const to = await page.evaluate(i => {
  const el = document.querySelector(`.lg-node[data-node-id="${i.LCM}"]`)
  const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + 12] // header centre
}, ids)
await page.mouse.move(...from); await page.mouse.down()
await page.mouse.move(to[0], to[1], { steps: 14 }); await page.waitForTimeout(400)
await page.mouse.up(); await page.waitForTimeout(1200)

const after = await page.evaluate(i => {
  const g = window.app.graph, LCM = g.getNodeById(Number(i.LCM))
  const link = LCM.inputs[i.maskIdx].link != null ? g.getLink(LCM.inputs[i.maskIdx].link) : null
  const el = document.querySelector(`.lg-node[data-node-id="${i.LCM}"]`)
  const maskDot = document.querySelector(`[data-slot-key="${i.LCM}-in-${i.maskIdx}"]`)
  const maskRow = maskDot?.closest('.lg-slot')
  return {
    maskLinked: !!link, origin: link ? String(link.origin_id) : null,
    drawer: el.dataset.cablemanagementInputs,
    maskRowVisible: maskRow ? maskRow.getBoundingClientRect().height > 5 : null,
    maskRowLinkedAttr: maskRow?.dataset.cablemanagementLinked ?? null,
  }
}, ids)
console.log('after drop-on-body:', JSON.stringify(after))
const pass = collapsedState.hidden >= 1 && after.maskLinked && after.origin === ids.SM &&
  after.drawer === 'collapsed' && after.maskRowVisible === true && after.maskRowLinkedAttr === '1'
console.log(pass ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
