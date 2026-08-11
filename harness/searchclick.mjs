// Bug B: select from the node search box with the MOUSE (a pointerdown), not Enter.
// The selection click must not retire the pending gesture -- provenance must still land.
// Handles the floating-placement flow: after selection, click to place the node.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })

// Search-box flow only; skip when the instance releases to a context menu instead
// (server-side Comfy.LinkRelease.Action -- see searchbox.mjs).
{
  const page = await b.newPage()
  await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForFunction(() => window.app?.extensionManager?.setting, null, { timeout: 120_000 })
  const action = await page.evaluate(() => window.app.extensionManager.setting.get('Comfy.LinkRelease.Action'))
  await page.close()
  if (action !== 'search box') {
    console.log(`SKIP: Comfy.LinkRelease.Action is '${action}' -- the search-box release flow is disabled on this instance`)
    await b.close()
    process.exit(0)
  }
}

async function runCase(kind) {
  const page = await b.newPage({ viewport: { width: 2100, height: 1000 } })
  const errs = []
  page.on('pageerror', e => errs.push(String(e).split('\n')[0]))
  await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.waitForFunction(() => window.app && window.app.graph, null, { timeout: 120_000 })
  await page.waitForTimeout(3000)
  const ids = await page.evaluate(async () => {
    const g = window.app.graph, L = window.LiteGraph; g.clear(); { const __d = window.app.canvas.ds; __d.scale = 1; __d.offset = [20, 20] }
    const CK = L.createNode('CheckpointLoaderSimple'); CK.pos = [60, 60]; g.add(CK)
    const A = L.createNode('CLIPTextEncode'); A.pos = [420, 160]; A.title = 'A'; g.add(A)
    CK.connect(1, A, A.inputs.findIndex(s => s.type === 'CLIP'))
    const wa = A.widgets.find(w => w.name === 'text'); wa.value = 'click flow'
    g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
    return { CK: String(CK.id), A: String(A.id), clipIdx: A.inputs.findIndex(s => s.type === 'CLIP'), textIdx: A.inputs.findIndex(s => s.widget?.name === 'text') }
  })
  const pin = await page.evaluate(({ ids, kind }) => {
    const p = [...document.querySelectorAll('.cablemanagement-pin')].find(x => x.dataset.cablemanagementNode === ids.A && x.dataset.cablemanagementKind === kind)
    if (!p) return null
    const r = p.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
  }, { ids, kind })
  if (!pin) { await page.close(); return { fail: 'no pin' } }
  const drop = [pin[0] + 80, pin[1] + 320]
  await page.mouse.move(...pin); await page.mouse.down()
  await page.mouse.move(drop[0], drop[1], { steps: 10 }); await page.waitForTimeout(400)
  await page.mouse.up()
  try {
    await page.waitForSelector('.comfy-vue-node-search-container input, .p-autocomplete input, input[type="text"]:focus', { timeout: 5000 })
  } catch { await page.close(); return { fail: 'no search box' } }
  await page.keyboard.type('CLIPTextEncode', { delay: 20 })
  await page.waitForTimeout(800)
  // MOUSE selection -- this is the pointerdown that used to retire pending.
  const opt = await page.waitForSelector('.option-container', { timeout: 4000 }).catch(() => null)
  if (!opt) { await page.close(); return { fail: 'no option item' } }
  await opt.click()
  await page.waitForTimeout(600)
  // Floating placement: if the node follows the cursor, a canvas click places it.
  await page.mouse.click(drop[0], drop[1])
  await page.waitForTimeout(1200)
  const res = await page.evaluate(({ ids, kind }) => {
    const g = window.app.graph
    const prim = g.nodes.find(n => n.type === 'PrimitiveNode')
    const fresh = g.nodes.filter(n => n.type === 'CLIPTextEncode' && String(n.id) !== ids.A)
    const N = fresh[fresh.length - 1]
    if (!N) return { fail: 'no new node' }
    const k = kind === 'link'
      ? N.inputs.findIndex(s => s.type === 'CLIP')
      : N.inputs.findIndex(s => s.widget?.name === 'text')
    const link = N.inputs[k]?.link != null ? (g.getLink ? g.getLink(N.inputs[k].link) : g.links[N.inputs[k].link]) : null
    return {
      node: String(N.id), linked: !!link, origin: link ? String(link.origin_id) : null,
      prim: prim ? String(prim.id) : null,
      provenance: N.properties?.['cablemanagement.from']?.[String(k)]?.slice(0, 2) ?? null,
      ledger: window.__cablemanagement?.ledger()?.size ?? 0,
    }
  }, { ids, kind })
  await page.close()
  return { ...res, ids, errs: errs.length }
}

const c1 = await runCase('link')
console.log('case1 (input pin, mouse):', JSON.stringify(c1))
const c2 = await runCase('widget')
console.log('case2 (widget pin, mouse):', JSON.stringify(c2))
const p1 = c1.linked && c1.origin === c1.ids?.CK && JSON.stringify(c1.provenance) === JSON.stringify([c1.ids?.A, c1.ids?.clipIdx]) && c1.ledger >= 1
const p2 = c2.linked && c2.origin === c2.prim && JSON.stringify(c2.provenance) === JSON.stringify([c2.ids?.A, c2.ids?.textIdx]) && c2.ledger >= 1
console.log('case1', p1 ? 'PASS' : 'FAIL', '| case2', p2 ? 'PASS' : 'FAIL')
await b.close()
process.exit(p1 && p2 ? 0 : 1)
