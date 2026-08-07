// Per-node-side lane allocation (Barney's spec): up-bending entries nest
// topmost-closest; down-benders start one lane beyond the farthest up-bender,
// bottommost-closest. KSampler scene -- model and positive approach from above
// (lanes 24, 29); negative and latent approach from below (CLIPTextEncode is tall,
// its out pin sits below the negative pin), so latent (bottommost) takes lane 34 and
// negative 39 (5px STUB_PITCH, polish round). The four entries must not cross.
import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => window.app?.graph && window.__cablemanagementPathing?.state?.patched, null, { timeout: 120_000 })
await page.waitForTimeout(3000)

const out = await page.evaluate(async () => {
  const app = window.app, g = app.graph, L = window.LiteGraph
  const P = window.__cablemanagementPathing
  const settle = async () => {
    for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 200)) }
  }
  const mk = (type, x, y) => { const n = L.createNode(type); n.pos = [x, y]; g.add(n); return n }
  g.clear()
  app.canvas.links_render_mode = P.PCB()
  const Ld = mk('CheckpointLoaderSimple', 100, 80)
  const Pn = mk('CLIPTextEncode', 100, 280)
  const Nn = mk('CLIPTextEncode', 100, 560)
  const En = mk('EmptyLatentImage', 100, 850)
  const K = mk('KSampler', 700, 520)
  Ld.connect(0, K, 0) // model      (slot 0, from above)
  Pn.connect(0, K, 1) // positive   (slot 1, from above)
  Nn.connect(0, K, 2) // negative   (slot 2, from above)
  En.connect(0, K, 3) // latent     (slot 3, from below)
  await settle()
  const routes = P.routes()
  // Entry lane = x of the second-to-last point (the final vertical feeding the stub).
  const entry = {}
  for (const r of routes) {
    const id = Number(r.key.split('|')[0])
    const ll = g._links.get(id)
    if (!ll || ll.target_id !== K.id) continue
    const pts = r.pts
    entry[ll.target_slot] = { laneX: pts[pts.length - 2][0], endX: pts[pts.length - 1][0], pts }
  }
  return { routes: routes.length, entry }
})

let pass = true
const slots = [0, 1, 2, 3]
if (slots.some((s) => !out.entry[s])) {
  console.log(`missing entries: have ${Object.keys(out.entry)}`)
  pass = false
} else {
  const d = slots.map((s) => out.entry[s].endX - out.entry[s].laneX) // stub length per slot
  const want = [24, 29, 39, 34]
  for (let i = 0; i < 4; i++) {
    const ok = Math.abs(d[i] - want[i]) <= 2
    console.log(`slot ${i}: stub=${d[i].toFixed(1)} want=${want[i]} ${ok ? 'ok' : 'MISMATCH'}`)
    if (!ok) pass = false
  }
  // No crossings among the four entries.
  const H = [], V = []
  slots.forEach((s) => {
    const pts = out.entry[s].pts
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], c = pts[k + 1]
      if (Math.abs(a[0] - c[0]) < 0.1) V.push({ s, x: a[0], lo: Math.min(a[1], c[1]), hi: Math.max(a[1], c[1]) })
      else H.push({ s, y: a[1], lo: Math.min(a[0], c[0]), hi: Math.max(a[0], c[0]) })
    }
  })
  let n = 0
  for (const h of H) for (const v of V) {
    if (h.s === v.s) continue
    if (v.x > h.lo + 1 && v.x < h.hi - 1 && h.y > v.lo + 1 && h.y < v.hi - 1) n++
  }
  console.log(`crossings among entries: ${n}`)
  if (n > 0) pass = false
}
console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
