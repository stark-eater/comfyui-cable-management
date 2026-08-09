// The v1 route registry (SCHEMA.md): adapter verbatim-ness, round-trip
// persistence, no-create discipline, and route identity.
//   s1 verbatim, synthetic: every legacy entry becomes its own single-claim
//      route -- srcs identical, conflict nulls preserved, no grouping
//      inferred, legacy keys removed.
//   s2 verbatim, real data: Barney's floating_input workflow extra (17
//      floatfrom + 56 routefrom entries) adapts 1:1.
//   s3 live load: the same workflow opened in the app -- legacy keys gone,
//      v1 bag present, serialize carries v1 only, ribbon intact.
//   s4 round-trip: fresh pin-drag claims survive serialize + reload.
//   s5 no-create: a graph without machinery never gains the key.
//   s6 identity: one gesture's chain stamps ONE shared route; adapted legacy
//      entries stay distinct.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const FIX = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'floating_input.json'), 'utf8'))
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
await page.waitForFunction(() => window.app?.graph && window.__cablemanagement?.routes && window.__cablemanagementCombs, null, { timeout: 120_000 })
await page.waitForTimeout(2600)

// ---- s1: verbatim adapter on a synthetic legacy bag ----
{
  const r = await page.evaluate(() => {
    const g = { extra: {
      cablemanagement_routefrom: { 10: ['5', 0], 11: ['5', 0], 12: null },
      cablemanagement_floatfrom: { 10: ['5', 0], 20: ['7', 2] },
      cablemanagement_gatefrom: { 99: ['5', 0] },
    } }
    const bag = window.__cablemanagement.routes(g)
    return { bag, leftover: Object.keys(g.extra).filter((k) => k !== 'cablemanagement_routes') }
  })
  const bag = r.bag
  const src = (kind, id) => bag.routes[bag.claims[kind][String(id)]]?.src ?? null
  ok('s1: all six claims present, legacy keys removed',
    Object.keys(bag.claims.reroutes).length === 3 && Object.keys(bag.claims.floats).length === 2 &&
    Object.keys(bag.claims.gatelinks).length === 1 && r.leftover.length === 0, JSON.stringify(r.leftover))
  ok('s1: srcs verbatim incl. the conflict null',
    JSON.stringify(src('reroutes', 10)) === '["5",0]' && JSON.stringify(src('reroutes', 11)) === '["5",0]' &&
    src('reroutes', 12) === null && JSON.stringify(src('floats', 20)) === '["7",2]' &&
    JSON.stringify(src('gatelinks', 99)) === '["5",0]')
  const ids = [bag.claims.reroutes['10'], bag.claims.reroutes['11'], bag.claims.floats['10']]
  ok('s1: no grouping inferred -- identical srcs still get distinct routes',
    new Set(ids).size === 3 && Object.keys(bag.routes).length === 6, JSON.stringify(ids))
}

// ---- s2: verbatim adapter on the real floating_input extra ----
{
  const legacy = {
    rf: FIX.extra.cablemanagement_routefrom,
    ff: FIX.extra.cablemanagement_floatfrom,
  }
  const r = await page.evaluate(({ legacy }) => {
    const g = { extra: {
      cablemanagement_routefrom: JSON.parse(JSON.stringify(legacy.rf)),
      cablemanagement_floatfrom: JSON.parse(JSON.stringify(legacy.ff)),
    } }
    const bag = window.__cablemanagement.routes(g)
    const res = (kind, id) => { const rid = bag.claims[kind][String(id)]; return rid === undefined ? undefined : bag.routes[rid]?.src ?? null }
    const mismatches = []
    for (const [k, v] of Object.entries(legacy.rf)) {
      const got = res('reroutes', k)
      if (JSON.stringify(got?.map?.(String) ?? got) !== JSON.stringify(v == null ? null : v.map(String))) mismatches.push(['rf', k, v, got])
    }
    for (const [k, v] of Object.entries(legacy.ff)) {
      const got = res('floats', k)
      if (JSON.stringify(got?.map?.(String) ?? got) !== JSON.stringify(v.map(String))) mismatches.push(['ff', k, v, got])
    }
    return {
      mismatches: mismatches.slice(0, 5),
      nR: Object.keys(bag.claims.reroutes).length,
      nF: Object.keys(bag.claims.floats).length,
      nRoutes: Object.keys(bag.routes).length,
    }
  }, { legacy })
  ok('s2: every fixture entry adapts 1:1 (56 rf + 17 ff)',
    r.nR === 56 && r.nF === 17 && r.nRoutes === 73 && r.mismatches.length === 0, JSON.stringify(r))
}

// ---- s3: live load of the fixture ----
{
  await page.evaluate(async ({ FIX }) => { await window.app.loadGraphData(JSON.parse(JSON.stringify(FIX))) }, { FIX })
  await page.waitForTimeout(2500)
  const r = await page.evaluate(() => {
    const g = window.app.graph
    const legacyLive = ['cablemanagement_routefrom', 'cablemanagement_floatfrom', 'cablemanagement_gatefrom'].filter((k) => g.extra?.[k])
    const saved = g.serialize()
    const legacySaved = ['cablemanagement_routefrom', 'cablemanagement_floatfrom', 'cablemanagement_gatefrom'].filter((k) => saved.extra?.[k])
    return {
      legacyLive, legacySaved,
      v1Live: !!g.extra?.cablemanagement_routes, v1Saved: !!saved.extra?.cablemanagement_routes,
      combs: (g.extra?.cablemanagement_combs ?? []).length,
      floats: g.floatingLinks?.size ?? 0,
    }
  })
  ok('s3: legacy keys gone live and on save; v1 present in both',
    r.legacyLive.length === 0 && r.legacySaved.length === 0 && r.v1Live && r.v1Saved, JSON.stringify(r))
  ok('s3: ribbons and floats survived the migration', r.combs === 5 && r.floats === 2, JSON.stringify(r))
}

// ---- s4 + s6: fresh claims, identity, round-trip ----
{
  const ids = await page.evaluate(async () => {
    const g = window.app.graph, L = window.LiteGraph; g.clear()
    const ds = window.app.canvas.ds; ds.scale = 1; ds.offset = [20, 20]
    { const taken = [L.STRAIGHT_LINK, L.LINEAR_LINK, L.SPLINE_LINK, L.HIDDEN_LINK]; let v = 64; while (taken.includes(v)) v++; window.app.canvas.links_render_mode = v }
    const A = L.createNode('EmptyLatentImage'); A.pos = [150, 100]; A.title = 'A'; g.add(A)
    const mk = (t, x, y) => { const n = L.createNode('KSampler'); n.pos = [x, y]; n.title = t; g.add(n); return n }
    const B = mk('B', 560, 80), C = mk('C', 1450, 80), D = mk('D', 1450, 500)
    const idx = B.inputs.findIndex((s) => s.name === 'latent_image')
    A.connect(0, B, idx)
    g.setDirtyCanvas(true, true); await new Promise((r) => setTimeout(r, 1500))
    const o = { idx }
    for (const n of [A, B, C, D]) o[n.title] = String(n.id)
    return o
  })
  const pinPos = (id, idx) => page.evaluate(({ id, idx }) => {
    const p = document.querySelector(`.cablemanagement-pin[data-cablemanagement-node="${id}"][data-cablemanagement-index="${idx}"]`)
    const r = p?.getBoundingClientRect(); return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
  }, { id, idx })
  const dotPos = (id, idx) => page.evaluate(({ id, idx }) => {
    const d = document.querySelector(`[data-slot-key="${id}-in-${idx}"]`)
    const r = d?.getBoundingClientRect(); return r?.width ? [r.x + r.width / 2, r.y + r.height / 2] : null
  }, { id, idx })
  const drag = async (from, to) => {
    await page.mouse.move(...from); await page.mouse.down()
    await page.mouse.move(to[0], to[1], { steps: 12 }); await page.waitForTimeout(300)
    await page.mouse.up(); await page.waitForTimeout(900)
  }
  await drag(await pinPos(ids.B, ids.idx), await dotPos(ids.C, ids.idx))
  await drag(await pinPos(ids.B, ids.idx), await dotPos(ids.D, ids.idx))
  const r = await page.evaluate(async ({ ids }) => {
    const g = window.app.graph
    const l1 = g.getNodeById(Number(ids.C)).inputs[ids.idx].link
    const l2 = g.getNodeById(Number(ids.D)).inputs[ids.idx].link
    window.__cablemanagementCombs.create(l1, l2, 1000, 300)
    await new Promise((x) => setTimeout(x, 900))
    window.__cablemanagement.sync?.()
    await new Promise((x) => setTimeout(x, 600))
    const bag = window.__cablemanagement.routes(g)
    const lanes = g.extra.cablemanagement_combs[0].lanes
    const laneOf = (lid) => lanes.find((l) => g.reroutes.get(l.out)?.linkIds?.has?.(Number(lid)))
    const lane1 = laneOf(l1)
    const claims = bag ? JSON.parse(JSON.stringify(bag.claims)) : null
    const routeIn = bag?.claims?.reroutes?.[String(lane1.in)]
    const routeOut = bag?.claims?.reroutes?.[String(lane1.out)]
    const saved = g.serialize()
    await window.app.loadGraphData(saved)
    await new Promise((x) => setTimeout(x, 1500))
    const g2 = window.app.graph
    const bag2 = window.__cablemanagement.routes(g2)
    return {
      claims, routeIn, routeOut,
      sameRoute: routeIn !== undefined && routeIn === routeOut,
      srcIn: bag?.routes?.[routeIn]?.src ?? null,
      reloadedClaims: bag2 ? JSON.parse(JSON.stringify(bag2.claims)) : null,
    }
  }, { ids })
  ok('s6: one wire, one identity -- both teeth of a lane share a route',
    r.sameRoute && JSON.stringify(r.srcIn) === JSON.stringify([ids.B, ids.idx]), JSON.stringify({ routeIn: r.routeIn, routeOut: r.routeOut, srcIn: r.srcIn }))
  ok('s4: claims survive serialize + reload verbatim',
    !!r.reloadedClaims && JSON.stringify(r.reloadedClaims) === JSON.stringify(r.claims), JSON.stringify(r.reloadedClaims))
}

// ---- s7: adoption-time defect detection ----
{
  const r = await page.evaluate(async () => {
    const g = window.app.graph, L = window.LiteGraph; g.clear()
    const A = L.createNode('EmptyLatentImage'); A.pos = [150, 100]; g.add(A)
    const K = L.createNode('KSampler'); K.pos = [700, 100]; g.add(K)
    const idx = K.inputs.findIndex((s) => s.name === 'latent_image')
    const link = A.connect(0, K, idx)
    const R = g.createReroute([450, 150], link)
    await new Promise((x) => setTimeout(x, 600))
    // A v0 bag: one claim fully alive, one on a dead reroute, one naming a
    // dead host, one float on a dead reroute.
    g.extra ??= {}
    g.extra.cablemanagement_routefrom = {
      [String(R.id)]: [String(A.id), 0],
      '9999': [String(A.id), 0],
      [String(R.id + 1000)]: ['777', 0],
    }
    g.extra.cablemanagement_routefrom[String(R.id)] = [String(A.id), 0]
    g.extra.cablemanagement_floatfrom = { '9998': [String(A.id), 0] }
    // Also a live-reroute claim whose HOST is dead -- must drop too.
    const R2 = g.createReroute([500, 250], link)
    g.extra.cablemanagement_routefrom[String(R2.id)] = ['777', 3]
    const bag = window.__cablemanagement.routes(g)
    return {
      rClaims: Object.keys(bag.claims.reroutes),
      fClaims: Object.keys(bag.claims.floats),
      routes: Object.keys(bag.routes).length,
      keptSrc: bag.routes[bag.claims.reroutes[String(R.id)]]?.src ?? null,
      R: String(R.id),
      legacyGone: !g.extra.cablemanagement_routefrom && !g.extra.cablemanagement_floatfrom,
    }
  })
  ok('s7: adoption keeps the living claim verbatim',
    r.rClaims.length === 1 && r.rClaims[0] === r.R && JSON.stringify(r.keptSrc?.[1]) === '0', JSON.stringify(r))
  ok('s7: dead-carrier and dead-host claims detected and dropped, routes died with them',
    r.fClaims.length === 0 && r.routes === 1 && r.legacyGone, JSON.stringify(r))
}

// ---- s5: no-create discipline ----
{
  const r = await page.evaluate(async () => {
    const g = window.app.graph, L = window.LiteGraph; g.clear()
    const A = L.createNode('EmptyLatentImage'); A.pos = [150, 100]; g.add(A)
    const K = L.createNode('KSampler'); K.pos = [600, 100]; g.add(K)
    A.connect(0, K, K.inputs.findIndex((s) => s.name === 'latent_image'))
    g.setDirtyCanvas(true, true); await new Promise((x) => setTimeout(x, 1200))
    window.__cablemanagement.sync?.()
    await new Promise((x) => setTimeout(x, 500))
    const saved = g.serialize()
    return { live: !!g.extra?.cablemanagement_routes, saved: !!saved.extra?.cablemanagement_routes }
  })
  ok('s5: a machinery-free graph never gains the key', !r.live && !r.saved, JSON.stringify(r))
}

console.log('page errors:', errs.length ? errs.slice(0, 8) : 'none')
if (errs.length) pass = false
console.log(pass ? 'PASS' : 'FAIL')
await b.close()
process.exit(pass ? 0 : 1)
