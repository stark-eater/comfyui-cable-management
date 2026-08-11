// Bug 4 E2E: release a pin drag on empty canvas, choose a node from the search box,
// and verify the created link carries provenance (so the ledger re-anchors it to the pin).
// Covers both pin kinds. Each case runs in a fresh page: picking from the search box
// recentres the camera and the extension must be tested against a clean view.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })

// The whole suite is about the SEARCH BOX release flow; with the server-side
// Comfy.LinkRelease.Action set to 'context menu' (Barney's decree) there is no
// box to test against -- skip cleanly rather than fail the battery.
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
  const page = await b.newPage({ viewport: { width: 1600, height: 900 } })
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
    g.setDirtyCanvas(true, true); await new Promise(r => setTimeout(r, 1700))
    return { CK: String(CK.id), A: String(A.id), clipIdx: A.inputs.findIndex(s => s.type === 'CLIP'), textIdx: A.inputs.findIndex(s => s.widget?.name === 'text') }
  })
  const pin = await page.evaluate(({ ids, kind }) => {
    const p = [...document.querySelectorAll('.cablemanagement-pin')].find(x => x.dataset.cablemanagementNode === ids.A && x.dataset.cablemanagementKind === kind)
    if (!p) return null
    const r = p.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]
  }, { ids, kind })
  if (!pin) { await page.close(); return { fail: 'no pin', errs } }
  await page.mouse.move(...pin); await page.mouse.down()
  await page.mouse.move(pin[0] + 60, pin[1] + 220, { steps: 10 }); await page.waitForTimeout(400)
  await page.mouse.up()
  try {
    await page.waitForSelector('input[type="text"]:focus, .p-autocomplete input, [data-testid="node-search-input"], .comfy-vue-node-search-container input', { timeout: 5000 })
  } catch {
    const trace = await page.evaluate(() => (window.__cablemanagementTrace ?? []).slice(-6))
    await page.close(); return { fail: 'no search box', trace, errs }
  }
  await page.keyboard.type('CLIPTextEncode', { delay: 20 })
  await page.waitForTimeout(700)
  await page.keyboard.press('Enter')
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
      provenance: N.properties?.['cablemanagement.from']?.[String(k)] ?? null,
      ledger: window.__cablemanagement?.ledger()?.size ?? 0,
    }
  }, { ids, kind })
  await page.close()
  return { ...res, ids, errs }
}

const c1 = await runCase('link')
console.log('case1 (input pin):', JSON.stringify({ ...c1, errs: c1.errs?.length }))
const c2 = await runCase('widget')
console.log('case2 (widget pin):', JSON.stringify({ ...c2, errs: c2.errs?.length }))

const p1 = c1.linked && c1.origin === c1.ids?.CK && JSON.stringify(c1.provenance?.slice(0, 2)) === JSON.stringify([c1.ids?.A, c1.ids?.clipIdx])
const p2 = c2.linked && c2.origin === c2.prim && JSON.stringify(c2.provenance?.slice(0, 2)) === JSON.stringify([c2.ids?.A, c2.ids?.textIdx])
console.log('case1', p1 ? 'PASS' : 'FAIL', '| case2', p2 ? 'PASS' : 'FAIL')
await b.close()
process.exit(p1 && p2 ? 0 : 1)
