// comfyui-pcb (daughter pack) validation against 8187 WITHOUT touching manager
// state. Two landmines this probe routes around, measured 2026-08-10:
//   - ABORTING wgimco's web files wedges the frontend (pendingSlotSync never
//     clears; NO links render, not even splines). Serve no-op modules instead.
//   - g.clear() + programmatic scene build only renders links when full wgimco
//     is live (something in it unwedges slot sync). Work ON the initially
//     loaded workflow: assert by MOVING existing routed nodes.
// Checks: daughter patches alone; routes exist; flatTol (align endpoints ->
// route gone = spline fallback); stub clamp (115px facing gap -> monotone-x
// short route, no fold); stand-down when wgimco is live.
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
const b = await chromium.launch({ headless: true })
const SERVER = process.env.COMFY_URL ?? 'http://127.0.0.1:8187'
const PCB_DIR = new URL('../../comfyui-pcb/web/', import.meta.url)

const serveDaughter = (page) => page.route('**/extensions/pcbtest/**', async (r) => {
  const rel = r.request().url().split('/extensions/pcbtest/')[1]
  try {
    await r.fulfill({ body: await readFile(new URL(rel, PCB_DIR)), contentType: 'application/javascript' })
  } catch {
    await r.abort()
  }
})

// ---- A: daughter alone (wgimco served as no-op modules) ----
const pa = await b.newPage({ viewport: { width: 2560, height: 1300 } })
pa.on('pageerror', (e) => console.log('PAGEERR', String(e).split('\n')[0]))
await pa.route('**/extensions/wgimco/**', (r) => {
  const u = r.request().url()
  if (u.endsWith('.js')) return r.fulfill({ body: 'export {}', contentType: 'application/javascript' })
  if (u.endsWith('.css')) return r.fulfill({ body: '', contentType: 'text/css' })
  return r.abort()
})
await serveDaughter(pa)
await pa.goto(SERVER, { waitUntil: 'domcontentloaded', timeout: 90_000 })
await pa.waitForFunction(() => window.app?.graph, null, { timeout: 120_000 })
await pa.waitForTimeout(4000)
await pa.evaluate(() => import('/extensions/pcbtest/index.js'))
await pa.waitForFunction(() => window.__pcb?.state?.patched, null, { timeout: 30_000 })
console.log('A alone:', await pa.evaluate(async () => {
  const g = window.app.graph
  window.app.canvas.links_render_mode = window.__pcb.PCB()
  const pump = async (n = 8) => { for (let i = 0; i < n; i++) { g.setDirtyCanvas(false, true); await new Promise((r) => setTimeout(r, 180)) } }
  const routeOf = (id) => window.__pcb.routes().filter((r) => r.key.startsWith(id + '|'))
  await pump()
  let link = null, route = null, tgt = null
  for (const l of g._links.values()) {
    const rs = routeOf(l.id)
    const t = g.getNodeById(l.target_id)
    if (rs.length && t) { link = l; route = rs[0]; tgt = t; break }
  }
  if (!link) return { fail: 'no routed link', routes: window.__pcb.routes().length }
  const a0 = route.pts[0], z0 = route.pts[route.pts.length - 1]
  tgt.pos = [tgt.pos[0], tgt.pos[1] + (a0[1] - z0[1]) + 1]
  g.setDirtyCanvas(true, true); await pump()
  const flatGone = routeOf(link.id).length === 0
  tgt.pos = [tgt.pos[0] - (z0[0] - a0[0]) + 115, tgt.pos[1] + 40]
  g.setDirtyCanvas(true, true); await pump()
  const clamp = routeOf(link.id)[0]
  const xs = clamp ? clamp.pts.map((pt) => pt[0] | 0) : null
  return {
    routes: window.__pcb.routes().length,
    flatGone,
    clampPts: clamp?.pts.length ?? null,
    clampMonotoneX: xs ? xs.every((x, i) => i === 0 || x >= xs[i - 1] - 1) : null
  }
}))

// ---- B: both live -> stand-down ----
const pb = await b.newPage({ viewport: { width: 1600, height: 900 } })
const logs = []
pb.on('console', (m) => { if (m.text().includes('[pcb]')) logs.push(m.text()) })
await serveDaughter(pb)
await pb.goto(SERVER, { waitUntil: 'domcontentloaded', timeout: 90_000 })
await pb.waitForFunction(() => window.app?.graph && window.__cablemanagementPathing?.state?.patched, null, { timeout: 120_000 })
await pb.evaluate(() => import('/extensions/pcbtest/index.js'))
await pb.waitForTimeout(2500)
console.log('B standdown:', await pb.evaluate(() => ({
  pcbPatched: !!window.__pcb?.state?.patched,
  mother: !!window.__cablemanagementPathing.state.patched
})), logs)
await b.close()
