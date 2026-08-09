// Modifier gestures on pass-through pins (audit 2g, Barney's greenlight:
// "shift+drag, ctrl+alt+click - yes, exactly").
//   shift+drag  = pick up ALL wires drawn from the pin -- only those; the
//                 host's own feed and the origin's hand-wired consumers stay
//   drop on out = bundle re-sources there
//   empty drop  = release action; dismiss disconnects the bundle
//   ctrl+alt    = instant cut of the pin's wires, no drag
//   no wires    = both degrade to the plain drag (core parity)
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 2560, height: 1300 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}

await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagement, null, { timeout: 120_000 })
await page.waitForTimeout(2600)

async function drag(from, to, mods = []) {
  for (const m of mods) await page.keyboard.down(m)
  await page.mouse.move(...from); await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(300)
  await page.mouse.up(); await page.waitForTimeout(1000)
  for (const m of mods) await page.keyboard.up(m)
}
const pinPos = (id, idx) => page.evaluate(({ id, idx }) => {
  const p = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-index="${idx}"]`)
  const r = p?.getBoundingClientRect(); return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx })
const dotPos = (id, idx, out) => page.evaluate(({ id, idx, out }) => {
  const d = document.querySelector(`[data-slot-key="${id}-${out ? 'out' : 'in'}-${idx}"]`)
  const r = d?.getBoundingClientRect(); return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
}, { id, idx, out })
const gp = (x, y) => page.evaluate(({ x, y }) => {
  const ds = window.app.canvas.ds
  const view = window.app.canvas.canvas.getBoundingClientRect()
  return [view.left + (x + ds.offset[0]) * ds.scale, view.top + (y + ds.offset[1]) * ds.scale]
}, { x, y })
const feed = (id, idx) => page.evaluate(({ id, idx }) => {
  const g = window.app.graph
  const n = g.getNodeById(Number(id))
  const lid = n.inputs?.[idx]?.link
  const link = lid != null ? g.getLink(lid) : null
  return {
    lid: lid ?? null, origin: link ? String(link.origin_id) : null,
    rec: n.properties?.['cablemanagement.from']?.[String(idx)] ?? null,
  }
}, { id, idx })
let neutral = null
const cleanup = async () => {
  if (await page.evaluate(() => document.querySelectorAll('.litecontextmenu').length)) {
    await page.mouse.click(...neutral); await page.waitForTimeout(500)
  }
  await page.evaluate(() => {
    document.querySelectorAll('.litecontextmenu').forEach((e) => e.remove())
    const lc = window.app.canvas.linkConnector
    if (lc?.isConnecting) lc.reset?.(true)
  })
  await page.waitForTimeout(300)
}

const ids = await page.evaluate(async () => {
  const g = window.app.graph, L = window.LiteGraph; g.clear()
  const ds = window.app.canvas.ds; ds.scale = 1; ds.offset = [20, 20]
  const A = L.createNode('EmptyLatentImage'); A.pos = [150, 120]; A.title = 'A'; g.add(A)
  const H = L.createNode('EmptyLatentImage'); H.pos = [150, 760]; H.title = 'H'; g.add(H)
  const mk = (t, x, y) => { const n = L.createNode('KSampler'); n.pos = [x, y]; n.title = t; g.add(n); return n }
  const B = mk('B', 560, 100), C = mk('C', 1450, 80), D = mk('D', 1450, 500), E = mk('E', 1450, 920)
  const idx = B.inputs.findIndex((s) => s.name === 'latent_image')
  const sIdx = B.inputs.findIndex((s) => s.name === 'seed')
  A.connect(0, B, idx)
  A.connect(0, E, idx) // hand-wired consumer of the origin: must never ride the bundle
  g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1700))
  const o = { idx, sIdx }
  for (const n of [A, H, B, C, D, E]) o[n.title] = String(n.id)
  return o
}, null)
neutral = await gp(950, 700)
const emptyPt = await gp(900, 1050)

const wire = async () => {
  await drag(await pinPos(ids.B, ids.idx), await dotPos(ids.C, ids.idx))
  await drag(await pinPos(ids.B, ids.idx), await dotPos(ids.D, ids.idx))
}
await wire()
const w0 = { c: await feed(ids.C, ids.idx), d: await feed(ids.D, ids.idx) }
ok('setup: pin wires C and D with records', w0.c.rec?.[0] === ids.B && w0.d.rec?.[0] === ids.B, JSON.stringify(w0))

// 1: shift+drag the bundle -- mid-drag honesty, then re-source onto H's output
{
  await page.keyboard.down('Shift')
  await page.mouse.move(...await pinPos(ids.B, ids.idx)); await page.mouse.down()
  await page.mouse.move(...await gp(900, 950), { steps: 10 }); await page.waitForTimeout(600)
  const mid = await page.evaluate(({ ids }) => {
    const g = window.app.graph, lc = window.app.canvas.linkConnector
    const bLink = g.getNodeById(Number(ids.B)).inputs[ids.idx].link
    const eLink = g.getNodeById(Number(ids.E)).inputs[ids.idx].link
    return {
      isConnecting: lc.isConnecting, to: lc.state?.connectingTo ?? null,
      moving: lc.state?.draggingExistingLinks ?? false, renderLinks: lc.renderLinks?.length ?? 0,
      hostHidden: !!g.getLink(bLink)?._dragging, handHidden: !!g.getLink(eLink)?._dragging,
    }
  }, { ids })
  await page.mouse.move(...await dotPos(ids.H, 0, true), { steps: 8 }); await page.waitForTimeout(300)
  await page.mouse.up(); await page.waitForTimeout(1000)
  await page.keyboard.up('Shift')
  ok('shift: bundle is exactly the pin\'s two wires, moving, seeking an output',
    mid.isConnecting && mid.to === 'output' && mid.moving && mid.renderLinks === 2, JSON.stringify(mid))
  ok('shift: host feed and hand-wired consumer stay visible during the drag',
    !mid.hostHidden && !mid.handHidden, JSON.stringify(mid))
  const after = {
    c: await feed(ids.C, ids.idx), d: await feed(ids.D, ids.idx),
    b: await feed(ids.B, ids.idx), e: await feed(ids.E, ids.idx),
  }
  ok('shift: C and D re-sourced to H', after.c.origin === ids.H && after.d.origin === ids.H, JSON.stringify(after))
  ok('shift: host feed and hand wire untouched', after.b.origin === ids.A && after.e.origin === ids.A,
    JSON.stringify({ b: after.b, e: after.e }))
  ok('shift: records left with the wires (genuine source now)', after.c.rec == null && after.d.rec == null,
    JSON.stringify({ c: after.c.rec, d: after.d.rec }))
  await cleanup()
}

// 2: shift+drag to empty canvas, dismiss the release action: bundle disconnects
{
  await wire()
  await drag(await pinPos(ids.B, ids.idx), emptyPt, ['Shift'])
  await cleanup() // blank click dismisses the menu; core disconnects the moved links
  const after = {
    c: await feed(ids.C, ids.idx), d: await feed(ids.D, ids.idx),
    b: await feed(ids.B, ids.idx), e: await feed(ids.E, ids.idx),
  }
  ok('shift+empty: bundle disconnected', after.c.lid == null && after.d.lid == null, JSON.stringify(after))
  ok('shift+empty: host feed and hand wire untouched', after.b.origin === ids.A && after.e.origin === ids.A,
    JSON.stringify({ b: after.b, e: after.e }))
  ok('shift+empty: no zombie records', after.c.rec == null && after.d.rec == null,
    JSON.stringify({ c: after.c.rec, d: after.d.rec }))
}

// 3: ctrl+alt+click cuts the pin's wires instantly, no drag
{
  await wire()
  await page.keyboard.down('Control'); await page.keyboard.down('Alt')
  await page.mouse.move(...await pinPos(ids.B, ids.idx)); await page.mouse.down()
  await page.waitForTimeout(300)
  const mid = await page.evaluate(() => {
    const lc = window.app.canvas.linkConnector
    return { isConnecting: lc.isConnecting, renderLinks: lc.renderLinks?.length ?? 0 }
  })
  await page.mouse.up(); await page.waitForTimeout(800)
  await page.keyboard.up('Alt'); await page.keyboard.up('Control')
  const after = {
    c: await feed(ids.C, ids.idx), d: await feed(ids.D, ids.idx),
    b: await feed(ids.B, ids.idx), e: await feed(ids.E, ids.idx),
  }
  ok('ctrl+alt: no drag session starts', !mid.isConnecting && mid.renderLinks === 0, JSON.stringify(mid))
  ok('ctrl+alt: pin wires cut, records gone',
    after.c.lid == null && after.d.lid == null && after.c.rec == null && after.d.rec == null, JSON.stringify(after))
  ok('ctrl+alt: host feed and hand wire untouched', after.b.origin === ids.A && after.e.origin === ids.A,
    JSON.stringify({ b: after.b, e: after.e }))
}

// 4: no wires left -- shift+drag degrades to the plain pin drag (core parity)
{
  await drag(await pinPos(ids.B, ids.idx), await dotPos(ids.C, ids.idx), ['Shift'])
  const c = await feed(ids.C, ids.idx)
  ok('parity: shift+drag with no wires is a plain pin drag (connects with record)',
    c.origin === ids.A && c.rec?.[0] === ids.B, JSON.stringify(c))
}

// 5: widget pin -- ctrl+alt cuts the widget wires; host and its literal unharmed
{
  await drag(await pinPos(ids.B, ids.sIdx), await dotPos(ids.C, ids.sIdx))
  const before = await feed(ids.C, ids.sIdx)
  await page.keyboard.down('Control'); await page.keyboard.down('Alt')
  await page.mouse.move(...await pinPos(ids.B, ids.sIdx)); await page.mouse.down()
  await page.waitForTimeout(300)
  await page.mouse.up(); await page.waitForTimeout(800)
  await page.keyboard.up('Alt'); await page.keyboard.up('Control')
  const after = await feed(ids.C, ids.sIdx)
  ok('widget ctrl+alt: wire was there, then cut with its record',
    before.lid != null && after.lid == null && after.rec == null, JSON.stringify({ before, after }))
}

// 6: self-drop guard -- a pin drag released on its own host's body is core's
// loopback no-op: the feed link keeps its ID and its reroute threading (the
// old behavior recreated it, silently orphaning the reroute).
{
  const before = await page.evaluate(async ({ ids }) => {
    const g = window.app.graph
    const lid = g.getNodeById(Number(ids.B)).inputs[ids.idx].link
    const r = g.createReroute([380, 250], g.getLink(lid))
    g.setDirtyCanvas(true, true); await new Promise((x) => setTimeout(x, 900))
    const link = g.getLink(g.getNodeById(Number(ids.B)).inputs[ids.idx].link)
    return { lid: link.id, parent: link.parentId ?? null, rid: r.id }
  }, { ids })
  const bodyPt = await page.evaluate(({ B }) => {
    const el = document.querySelector(`[data-node-id="${B}"]`)
    const r = el.getBoundingClientRect()
    return [r.x + r.width / 2, r.y + 12] // title bar center
  }, { B: ids.B })
  await drag(await pinPos(ids.B, ids.idx), bodyPt)
  await cleanup()
  const after = await page.evaluate(({ ids }) => {
    const g = window.app.graph
    const link = g.getLink(g.getNodeById(Number(ids.B)).inputs[ids.idx].link)
    return { lid: link?.id ?? null, parent: link?.parentId ?? null, reroutes: g.reroutes.size }
  }, { ids })
  ok('self-drop on host title: strict no-op -- same link id, threading intact',
    after.lid === before.lid && after.parent === before.parent && before.parent === before.rid,
    JSON.stringify({ before, after }))
  // widget-row release on the host: same no-op (the row is not a valid target)
  const rowPt = await page.evaluate(({ B }) => {
    const el = document.querySelector(`[data-node-id="${B}"]`)
    const r = el.getBoundingClientRect()
    return [r.x + r.width / 2, r.y + r.height * 0.6]
  }, { B: ids.B })
  await drag(await pinPos(ids.B, ids.idx), rowPt)
  await cleanup()
  const after2 = await page.evaluate(({ ids }) => {
    const g = window.app.graph
    const link = g.getLink(g.getNodeById(Number(ids.B)).inputs[ids.idx].link)
    return { lid: link?.id ?? null, parent: link?.parentId ?? null }
  }, { ids })
  ok('self-drop on host widget rows: still a no-op',
    after2.lid === before.lid && after2.parent === before.parent, JSON.stringify({ before, after2 }))
}

console.log('page errors:', errs.length ? errs.slice(0, 4) : 'none')
if (errs.length) pass = false
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
