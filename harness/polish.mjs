// Polish checks: (1) NodeBadges (pack pills) sits BELOW the outputs block in cablemanagement layout;
// (2) collapse carets show up/down by state on a pill, and a collapsed drawer shows an
// always-on ellipsis below its last visible row, which reopens on click.
import { chromium } from 'playwright'
import fs from 'node:fs'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

// Part 1: badges order on the real workflow (his pack nodes carry pills).
const wf = JSON.parse(fs.readFileSync('E:/Projects/ComfyUI-5/user/default/workflows/CU5-v1-ft.json', 'utf8'))
await page.evaluate(async d => await window.app.loadGraphData(d), wf)
await page.waitForTimeout(2500)
const badges = await page.evaluate(() => {
  const out = []
  for (const nodeEl of document.querySelectorAll('.lg-node[data-node-id]')) {
    const body = nodeEl.querySelector('[data-testid^="node-body-"]')
    const badge = body?.querySelector(':scope > .mt-auto')
    const outputs = body?.querySelector(':scope > div > .ml-auto') ?? body?.querySelector(':scope > .ml-auto')
    if (!badge || !outputs) continue
    const br = badge.getBoundingClientRect(), or = outputs.getBoundingClientRect()
    if (!br.height || !or.height) continue
    out.push({ id: nodeEl.dataset.nodeId, badgeTop: Math.round(br.top), outputsBottom: Math.round(or.bottom), below: br.top >= or.bottom - 2 })
  }
  return out
})
const badgesPass = badges.length > 0 && badges.every(x => x.below)
console.log(`badges: ${badges.length} nodes checked, all below outputs: ${badgesPass}`)
badges.slice(0, 4).forEach(x => console.log(`  node ${x.id}: badgeTop=${x.badgeTop} outputsBottom=${x.outputsBottom} below=${x.below}`))

// Part 2: collapse UI on a synthetic graph.
const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [60, 80]; g.add(CK)
  const K = L.createNode('KSampler'); K.pos = [520, 80]; g.add(K)
  CK.connect(0, K, K.inputs.findIndex(s => s.type === 'MODEL'))
  g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
  return { CK: String(CK.id), K: String(K.id) }
})
const before = await page.evaluate(i => {
  const el = document.querySelector(`.lg-node[data-node-id="${i.K}"]`)
  const caret = el?.querySelector('.cablemanagement-collapse[data-which="inputs"]')
  return { caret: caret?.textContent, bg: caret ? getComputedStyle(caret).backgroundColor : null, more: !!el?.querySelector('.cablemanagement-more') }
}, ids)
await page.evaluate(i => {
  document.querySelector(`.lg-node[data-node-id="${i.K}"] .cablemanagement-collapse[data-which="inputs"]`)?.click()
}, ids)
await page.waitForTimeout(700)
const collapsed = await page.evaluate(i => {
  const el = document.querySelector(`.lg-node[data-node-id="${i.K}"]`)
  const caret = el.querySelector('.cablemanagement-collapse[data-which="inputs"]')
  const more = el.querySelector('.cablemanagement-more[data-which="inputs"]')
  const rows = [...el.querySelectorAll('.lg-slot--input')].filter(r => !r.closest('.lg-node-widget'))
  const hiddenCount = rows.filter(r => r.getBoundingClientRect().height < 1).length
  const lastVisible = rows.filter(r => r.getBoundingClientRect().height >= 1).pop()
  const firstWidget = el.querySelector('.lg-node-widget')
  const nr = el.getBoundingClientRect()
  return {
    state: el.dataset.cablemanagementInputs, caret: caret?.textContent, hiddenCount, totalRows: rows.length,
    more: !!more, moreLeft: more ? getComputedStyle(more).left : null,
    moreTop: more ? Math.round(more.getBoundingClientRect().top - nr.top) : null,
    lastRowBottom: lastVisible ? Math.round(lastVisible.getBoundingClientRect().bottom - nr.top) : null,
    gap: lastVisible && firstWidget
      ? Math.round(firstWidget.getBoundingClientRect().top - lastVisible.getBoundingClientRect().bottom)
      : null,
  }
}, ids)
await page.screenshot({ path: 'E:/Projects/ComfyUI-5/cablemanagement-screenshots/polish-collapsed.png', clip: { x: 400, y: 60, width: 700, height: 500 } })
await page.evaluate(i => {
  document.querySelector(`.lg-node[data-node-id="${i.K}"] .cablemanagement-more[data-which="inputs"]`)?.click()
}, ids)
await page.waitForTimeout(700)
const reopened = await page.evaluate(i => {
  const el = document.querySelector(`.lg-node[data-node-id="${i.K}"]`)
  return { state: el.dataset.cablemanagementInputs, more: !!el.querySelector('.cablemanagement-more'), caret: el.querySelector('.cablemanagement-collapse[data-which="inputs"]')?.textContent }
}, ids)
console.log('before  :', JSON.stringify(before))
console.log('collapsed:', JSON.stringify(collapsed))
console.log('reopened:', JSON.stringify(reopened))
const inGap = collapsed.moreTop != null && collapsed.lastRowBottom != null &&
  collapsed.moreTop >= collapsed.lastRowBottom && collapsed.moreTop <= collapsed.lastRowBottom + 16
const hasGap = collapsed.gap != null && collapsed.gap >= 12
const pass = badgesPass && before.caret === '\u25B4' && !before.more &&
  collapsed.state === 'collapsed' && collapsed.caret === '\u25BE' && collapsed.hiddenCount > 0 &&
  collapsed.more && inGap && hasGap && reopened.state === 'open' && !reopened.more && reopened.caret === '\u25B4'
console.log(pass ? 'PASS' : 'FAIL')
console.log('page errors:', errs.length); errs.slice(0, 4).forEach(e => console.log('  ' + e.slice(0, 140)))
await b.close()
process.exit(pass ? 0 : 1)
