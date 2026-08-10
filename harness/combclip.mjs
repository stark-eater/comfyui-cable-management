// Clipboard survival for ribbons (combclipboard.js).
//   s1 full selection: paste rebuilds a second comb, links thread the new teeth
//   s2 pasted comb is independent -- teeth/link ids disjoint from the original
//   s3 targets-only selection: paste synthesizes floating lanes parked on pasted inputs
//   s4 sources-only selection: floating lanes hang off pasted outputs
//   s5 one lane's ends outside the selection: that lane is dropped, comb decomposes to reroutes
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 2560, height: 1300 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagementPathing?.state?.patched && window.__cablemanagementCombs, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}

// Scene: 2-lane ribbon between two sources and two consumers.
const build = () => page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const ds = window.app.canvas.ds; ds.scale = 1; ds.offset = [20, 20]
  window.app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
  const s1 = mk('EmptyLatentImage', 60, 100)
  const s2 = mk('CheckpointLoaderSimple', 60, 400)
  const y1 = mk('KSampler', 1200, 80)
  const y2 = mk('CheckpointSave', 1200, 500)
  const idx = y1.inputs.findIndex((s) => s.name === 'latent_image')
  s1.connect(0, y1, idx); s2.connect(0, y2, 0)
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1500))
  window.__cablemanagementCombs.create(y1.inputs[idx].link, y2.inputs[0].link, 500, 280)
  await new Promise((r) => setTimeout(r, 900))
  return { s1: s1.id, s2: s2.id, y1: y1.id, y2: y2.id }
})

const copyPaste = async (nodeIds) => {
  if (nodeIds) {
    await page.evaluate((ids) => {
      const g = window.app.graph
      window.app.canvas.selectItems(ids.map((id) => g.getNodeById(id)))
    }, nodeIds)
  } else {
    await page.mouse.click(1280, 1000)
    await page.waitForTimeout(300)
    await page.keyboard.press('Control+a')
  }
  await page.waitForTimeout(400)
  await page.keyboard.press('Control+c')
  await page.waitForTimeout(300)
  await page.mouse.move(700, 950)
  await page.waitForTimeout(200)
  await page.keyboard.press('Control+v')
  await page.waitForTimeout(1200)
}

const snap = () => page.evaluate(() => {
  const g = window.app.graph
  return {
    nodes: g._nodes.length,
    reroutes: g.reroutes.size,
    links: g._links.size,
    floating: g.floatingLinks?.size ?? 0,
    combs: (g.extra.cablemanagement_combs ?? []).map((c) => ({
      lanes: c.lanes.map((l) => {
        const tout = g.reroutes.get(l.out)
        const floats = [...(g.floatingLinks?.values?.() ?? [])].filter((f) => f.parentId === l.in || f.parentId === l.out)
        return {
          rids: [l.in, l.out],
          linkIds: tout ? [...tout.linkIds] : null,
          floatEnds: floats.map((f) => ({ o: String(f.origin_id), t: String(f.target_id) }))
        }
      })
    }))
  }
})

// ---- s1/s2: full selection ----
let ids = await build()
await copyPaste(null)
let s = await snap()
const c2 = s.combs[1]
ok('s1: full paste rebuilds the comb, links thread new teeth',
  s.combs.length === 2 && s.nodes === 8 && s.links === 4 &&
  c2?.lanes.length === 2 && c2.lanes.every((l) => l.linkIds?.length === 1),
  JSON.stringify(s))
const orig = s.combs[0]
const disjoint = c2 && orig.lanes.every((a) => c2.lanes.every((b) =>
  !a.rids.some((r) => b.rids.includes(r)) && !a.linkIds.some((x) => b.linkIds.includes(x))))
ok('s2: pasted comb independent of the original', !!disjoint)

// ---- s3: targets only -> parked floating lanes ----
ids = await build()
await copyPaste([ids.y1, ids.y2])
s = await snap()
const f3 = s.combs[1]
ok('s3: targets-only pastes parked floating lanes',
  s.combs.length === 2 && f3?.lanes.length === 2 &&
  f3.lanes.every((l) => l.linkIds?.length === 0 && l.floatEnds.length === 1 && l.floatEnds[0].o === '-1'),
  JSON.stringify(s.combs[1] ?? null))

// ---- s4: sources only -> hanging floating lanes ----
ids = await build()
await copyPaste([ids.s1, ids.s2])
s = await snap()
const f4 = s.combs[1]
ok('s4: sources-only pastes hanging floating lanes',
  s.combs.length === 2 && f4?.lanes.length === 2 &&
  f4.lanes.every((l) => l.floatEnds.length === 1 && l.floatEnds[0].t === '-1'),
  JSON.stringify(s.combs[1] ?? null))

// ---- s5: one lane fully outside the selection -> dropped; survivor decomposes ----
ids = await build()
await copyPaste([ids.s1, ids.y1]) // the latent lane only; checkpoint lane's ends excluded
s = await snap()
// A 1-lane comb record auto-decomposes (teeth stay as plain reroutes carrying the link).
const links5 = await page.evaluate(() => [...window.app.graph._links.values()].map((l) => String(l.origin_id)))
ok('s5: unselected lane dropped, single survivor decomposes',
  s.combs.length === 1 && s.nodes === 6 && s.links === 3 && s.reroutes === 6,
  JSON.stringify({ combs: s.combs.length, nodes: s.nodes, links: s.links, reroutes: s.reroutes, links5 }))

ok('no page errors', errs.length === 0, errs.join(' | '))
await b.close()
if (!pass) process.exit(1)
console.log('PASS')
