// SWEEP CELL I -- decomposition flavours x ops, INPUT passthrough flavour.
//
// Scene per flavour (fresh rebuild): A CheckpointLoaderSimple hand-wired to S1
// CheckpointSave (model+clip), the two S1 input pins dragged onto S2 CheckpointSave
// (INPUT-flavour passthroughs: provenance record only, no owned-primitive fallback),
// both links combed. Flavours: (a) select IN gate + Delete, (b) select OUT gate +
// Delete, (c) select both gates + Delete (links heal plain), (d) api.decompose.
// After each flavour: programmatic S2 move, new unrelated link, mouse-drag a
// leftover reroute 60px (skip if none), serialize+configure roundtrip -- with the
// two sweep invariants asserted after every op:
//   [anchor]  passthrough draw start within 1.5px of the baseline S1 pin anchor,
//             never within 30px of the true origin (A's output slots); no route
//             starting within 30px of the true origin either.
//   [orphans] no reroute with empty linkIds+floatingLinkIds, no comb lane whose
//             two teeth both carry nothing, no comb record below 2 lanes.
import { chromium } from 'playwright'

const b = await chromium.launch({ headless: true })
const page = await b.newPage({ viewport: { width: 1900, height: 1000 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]))
await page.goto(process.env.COMFY_URL ?? 'http://127.0.0.1:8187', { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(
  () => window.app?.graph && window.__cablemanagementPathing?.state?.patched && window.__cablemanagementCombs,
  null, { timeout: 120_000 }
)
await page.waitForTimeout(2500)

let pass = true
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' -- ' + extra : ''}`)
  if (!cond) pass = false
}
const drag = async (from, to) => {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 12 })
  await page.waitForTimeout(250)
  await page.mouse.up()
  await page.waitForTimeout(800)
}
// Fresh draw capture: reset the map, burn 6 frames (ghost-route trap).
const fresh = () => page.evaluate(async () => {
  window.__cablemanagementCapture = true
  window.__cablemanagementDraw = new Map()
  const g = window.app.graph
  for (let i = 0; i < 6; i++) { g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 150)) }
})

// ---- scene build (per flavour) ---------------------------------------------------
const build = async () => {
  const ids = await page.evaluate(async () => {
    const app = window.app, g = app.graph, L = window.LiteGraph
    g.clear()
    app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
    const mk = (t, x, y) => { const n = L.createNode(t); n.pos = [x, y]; g.add(n); return n }
    const A = mk('CheckpointLoaderSimple', 80, 100)
    const S1 = mk('CheckpointSave', 620, 80)
    const S2 = mk('CheckpointSave', 1400, 420)
    A.connect(0, S1, 0) // model
    A.connect(1, S1, 1) // clip
    g.setDirtyCanvas(true, true)
    await new Promise((r) => setTimeout(r, 1800)) // let the sync pass grow the pins
    return { A: String(A.id), S1: String(S1.id), S2: String(S2.id) }
  })
  const pinPt = (idx) => page.evaluate(([nid, idx]) => {
    const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
      (x) => x.dataset.cablemanagementNode === nid && x.dataset.cablemanagementIndex === String(idx) &&
        x.dataset.cablemanagementKind !== 'widget'
    )
    const r = el?.getBoundingClientRect()
    return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
  }, [ids.S1, idx])
  const slotPt = (key) => page.evaluate((k) => {
    const r = document.querySelector(`[data-slot-key="${k}"]`)?.getBoundingClientRect()
    return r ? [r.x + r.width / 2, r.y + r.height / 2] : null
  }, key)
  const p0 = await pinPt(0)
  if (!p0) throw new Error('input pin 0 never appeared on S1')
  await drag(p0, await slotPt(`${ids.S2}-in-0`))
  const p1 = await pinPt(1)
  if (!p1) throw new Error('input pin 1 never appeared on S1')
  await drag(p1, await slotPt(`${ids.S2}-in-1`))
  const combId = await page.evaluate((arg) => {
    const g = window.app.graph
    const links = [...g._links.values()]
      .filter((l) => String(l.target_id) === String(arg.S2)).map((l) => l.id)
    if (links.length !== 2) return null
    const id = window.__cablemanagementCombs.create(links[0], links[1], 900, 260)
    window.__cablemanagementCombs.move(id, 'out', 1150, 260)
    return id
  }, ids)
  if (combId == null) throw new Error('pin drags did not produce two passthrough links')
  await page.waitForTimeout(600)
  // Baseline pin anchors, graph space -- the ledger's own formula (anchorOf).
  const base = await page.evaluate((arg) => {
    const g = window.app.graph
    const S1 = g.getNodeById(Number(arg.S1))
    const TITLE = window.LiteGraph?.NODE_TITLE_HEIGHT ?? 30
    const out = {}
    for (const idx of [0, 1]) {
      const el = [...document.querySelectorAll('.cablemanagement-pin')].find(
        (x) => x.dataset.cablemanagementNode === arg.S1 && x.dataset.cablemanagementIndex === String(idx) &&
          x.dataset.cablemanagementKind !== 'widget'
      )
      out[idx] = el && S1
        ? [S1.pos[0] + el.offsetLeft + el.offsetWidth * 0.5, S1.pos[1] - TITLE + el.offsetTop + el.offsetHeight * 0.5]
        : null
    }
    return out
  }, ids)
  if (!base[0] || !base[1]) throw new Error('baseline pin anchors missing')
  return { ids, combId, base }
}

// ---- the two invariants, one ok-line each ----------------------------------------
const check = async (scene, tag) => {
  await fresh()
  const s = await page.evaluate((arg) => {
    const g = window.app.graph
    const draw = window.__cablemanagementDraw ?? new Map()
    const A = g.getNodeById(Number(arg.ids.A))
    const S2 = g.getNodeById(Number(arg.ids.S2))
    const origins = [A?.getConnectionPos(false, 0) ?? null, A?.getConnectionPos(false, 1) ?? null]
    const links = [...g._links.values()].filter(
      (l) => String(l.target_id) === String(arg.ids.S2) && String(l.origin_id) === String(arg.ids.A)
    )
    const per = links.map((l) => {
      const d = draw.get(l.id) ?? null
      const exp = arg.base[l.target_slot] ?? null
      return {
        id: l.id, slot: l.target_slot, start: d ? [d[0], d[1]] : null,
        dBase: d && exp ? +Math.hypot(d[0] - exp[0], d[1] - exp[1]).toFixed(2) : null,
        dOrg: d ? +Math.min(...origins.filter(Boolean).map((o) => Math.hypot(d[0] - o[0], d[1] - o[1]))).toFixed(1) : null
      }
    })
    // Route keys lead with the link id. The hand-drawn A->S1 links legitimately
    // start at A's outputs (INPUT flavour: the true origin is a visible node), so
    // the near-origin route check is scoped to the PASSTHROUGH links' own routes.
    const passIds = new Set(links.map((l) => String(l.id)))
    const nearOrigin = (window.__cablemanagementPathing.routes() ?? []).filter((r) =>
      passIds.has(String(r.key).split('|')[0]) &&
      origins.some((o) => o && Math.hypot(r.pts[0][0] - o[0], r.pts[0][1] - o[1]) < 30)
    ).map((r) => r.key)
    const orphanRr = [...(g.reroutes?.values() ?? [])]
      .filter((r) => !(r.linkIds?.size) && !(r.floatingLinkIds?.size)).map((r) => r.id)
    const combs = g.extra?.cablemanagement_combs ?? []
    const orphanLanes = []
    for (const c of combs) {
      for (const l of c.lanes) {
        const ti = g.reroutes?.get?.(l.in), to = g.reroutes?.get?.(l.out)
        if (ti && to && !(ti.linkIds?.size) && !(to.linkIds?.size) &&
          !(ti.floatingLinkIds?.size) && !(to.floatingLinkIds?.size)) orphanLanes.push({ ...l, comb: c.id })
      }
    }
    const shortCombs = combs.filter((c) => c.lanes.length < 2).map((c) => c.id)
    return {
      per, nearOrigin, orphanRr, orphanLanes, shortCombs,
      combs: combs.length, reroutes: g.reroutes?.size ?? 0,
      prov: S2?.properties?.['cablemanagement.from'] ?? null
    }
  }, scene)
  const aOk = s.per.length === 2 &&
    s.per.every((p) => p.dBase != null && p.dBase <= 1.5 && p.dOrg != null && p.dOrg > 30) &&
    s.nearOrigin.length === 0
  ok(`${tag} [anchor]`, aOk, aOk ? '' : JSON.stringify({ per: s.per, nearOrigin: s.nearOrigin, prov: s.prov }))
  const oOk = s.orphanRr.length === 0 && s.orphanLanes.length === 0 && s.shortCombs.length === 0
  ok(`${tag} [orphans]`, oOk, oOk ? '' : JSON.stringify({ rr: s.orphanRr, lanes: s.orphanLanes, short: s.shortCombs }))
  return s
}

// ---- decomposition helpers -------------------------------------------------------
// Safe gate-body press point in graph coords (pins-left: +18, pins-right: +6).
const gateScreen = (which) => page.evaluate((which) => {
  const c = window.app.graph.extra.cablemanagement_combs[0]
  const h = 24 + (c.lanes.length - 1) * 20
  const x = c[which].pins === 'left' ? c[which].pos[0] + 18 : c[which].pos[0] + 6
  const { ds } = window.app.canvas
  return [(x + ds.offset[0]) * ds.scale, (c[which].pos[1] + h / 2 + ds.offset[1]) * ds.scale]
}, which)
const clickGate = async (which, shift = false) => {
  const p = await gateScreen(which)
  if (shift) await page.keyboard.down('Shift')
  await page.mouse.click(p[0], p[1])
  if (shift) await page.keyboard.up('Shift')
  await page.waitForTimeout(300)
}
const pressDelete = async () => {
  await page.keyboard.press('Delete')
  await page.waitForTimeout(600)
}

// ---- op sequence (shared by every flavour) ---------------------------------------
const runOps = async (scene, f) => {
  // op1: programmatic node move via the pos setter (grid multiples: +40).
  await page.evaluate((arg) => {
    const n = window.app.graph.getNodeById(Number(arg.S2))
    n.pos = [n.pos[0] + 40, n.pos[1] + 40]
    window.app.graph.setDirtyCanvas(true, true)
  }, scene.ids)
  await page.waitForTimeout(500)
  await check(scene, `${f}/move`)

  // op2: new unrelated link (EmptyLatentImage -> LatentCompositeMasked destination).
  await page.evaluate(() => {
    const g = window.app.graph, L = window.LiteGraph
    const E = L.createNode('EmptyLatentImage'); E.pos = [80, 700]; g.add(E)
    const C = L.createNode('LatentCompositeMasked'); C.pos = [600, 700]; g.add(C)
    E.connect(0, C, C.inputs.findIndex((s) => s.name === 'destination'))
  })
  await page.waitForTimeout(500)
  await check(scene, `${f}/newlink`)

  // op3: mouse-drag a leftover reroute 60px (skip when the flavour left none).
  const rr = await page.evaluate(() => {
    const r = [...(window.app.graph.reroutes?.values() ?? [])][0]
    if (!r) return null
    const { ds } = window.app.canvas
    return { id: r.id, pos: r.pos.slice(), screen: [(r.pos[0] + ds.offset[0]) * ds.scale, (r.pos[1] + ds.offset[1]) * ds.scale] }
  })
  if (rr) {
    await drag(rr.screen, [rr.screen[0], rr.screen[1] + 60])
    // Coverage honesty: a mousedown that missed the dot pans instead and the op
    // silently never happens. Not an invariant -- just prove the dot moved.
    const moved = await page.evaluate((rr) => {
      const r = window.app.graph.reroutes?.get?.(rr.id)
      return r ? [r.pos[0] - rr.pos[0], r.pos[1] - rr.pos[1]] : null
    }, rr)
    console.log(`--   ${f}/rdrag dot ${rr.id} moved ${JSON.stringify(moved)}`)
    await check(scene, `${f}/rdrag`)
  } else {
    console.log(`--   ${f}/rdrag skipped (no leftover reroutes)`)
  }

  // op4: serialize + configure roundtrip (ids survive, PCB must be re-set).
  await page.evaluate(async () => {
    const app = window.app, g = app.graph
    const data = g.serialize()
    g.configure(data)
    app.canvas.links_render_mode = window.__cablemanagementPathing.PCB()
  })
  await page.waitForTimeout(1500)
  await check(scene, `${f}/roundtrip`)
}

// ---- flavours --------------------------------------------------------------------
const flavours = {
  a: async () => { await clickGate('in'); await pressDelete() },
  b: async () => { await clickGate('out'); await pressDelete() },
  c: async () => { await clickGate('in'); await clickGate('out', true); await pressDelete() },
  d: async (combId) => {
    await page.evaluate((id) => window.__cablemanagementCombs.decompose(id), combId)
    await page.waitForTimeout(600)
  }
}

for (const f of ['a', 'b', 'c', 'd']) {
  console.log(`==== flavour ${f} ====`)
  const scene = await build()
  const baseState = await check(scene, `${f}/base`)
  if (baseState.combs !== 1) console.log(`--   ${f}/base combs=${baseState.combs} (expected 1)`)
  await flavours[f](scene.combId)
  const s = await check(scene, `${f}/decomp`)
  console.log(`--   ${f}/decomp combs=${s.combs} reroutes=${s.reroutes}`)
  await runOps(scene, f)
}

console.log('page errors:', errs.length ? errs : 'none')
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
