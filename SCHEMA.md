# Cable Management -- serialized schema (v1)

This document is the compatibility commitment for every shape Cable Management
writes into a workflow file. Anything not documented here is internal and may
change without notice; everything below is stable API from v1 onward.

Version policy:

- `graph.extra.cablemanagement_routes.v` versions the whole family below.
- Minor evolutions are additive only (new optional fields, new claim kinds);
  readers must ignore fields they do not know.
- A major bump may restructure, shipping either a migration or the documented
  degradation (below). Consumers should treat an unknown major as opaque.
- Degradation rule (holds at every version, including extension-off): the real
  links in the graph are always the truth. Every shape here is annotation --
  grouping, provenance, drawing. Stripping all of it leaves a working workflow
  wired through ordinary links and reroutes.

## graph.extra.cablemanagement_routes (v1)

The route registry: identity for apparent-source provenance. A ROUTE is one
apparent source (a pass-through pin) and the set of graph objects that claim
it. Claims are point-keyed for O(1) lookup; the route object is the shared
identity behind them.

```json
{
  "v": 1,
  "seq": 7,
  "routes": {
    "3": { "src": ["28", 0] },
    "4": { "src": null }
  },
  "claims": {
    "reroutes":  { "93": "3", "94": "3" },
    "floats":    { "126": "3" },
    "gatelinks": { "219": "3" }
  }
}
```

- `seq` -- next route id (monotonic, never reused).
- `routes[id].src` -- `[hostNodeId, hostInputIndex]`: the pass-through pin the
  route apparently descends from. `null` marks a CONFLICT route: objects
  claimed by links of differing provenance; readers inherit nothing from it.
- `claims.reroutes[rerouteId] -> routeId` -- route provenance on a hop
  (reroute or ribbon tooth): links later reconnected through this hop inherit
  the route's src as their apparent source.
- `claims.floats[rerouteId] -> routeId` -- a floating link whose chain
  contains this reroute draws from the route's src instead of its true origin.
- `claims.gatelinks[linkId] -> routeId` -- a link terminating at a subgraph
  output gate draws from the route's src (gates carry no properties bag).
- Lifecycle: a route exists while it has at least one claim; removing the last
  claim removes the route. Dead reroutes/links/hosts drop their claims on the
  next prune pass.

Legacy (v0) shapes -- `cablemanagement_routefrom`, `cablemanagement_floatfrom`,
`cablemanagement_gatefrom` in `graph.extra` -- are translated VERBATIM on
first touch: each entry becomes its own single-claim route (no grouping or
intent is inferred), the legacy keys are removed, and they are never written
again. Routes with more than one claim only emerge from fresh gestures.
Adoption then runs a defect check against the graph itself: v0 could not
guarantee its annotations matched the graph, so any translated claim whose
carrier (reroute / gate link) or source host provably no longer exists is
dropped and reported to the console. This is detection against graph truth,
not reinterpretation -- nothing that still references living objects is
touched.

## graph.extra.cablemanagement_combs (v1, carried over unchanged)

Ribbon combs: gate-pair groupings over native reroutes ("teeth").

```json
[{ "id": 2,
   "in":  { "pos": [x, y], "pins": "left" },
   "out": { "pos": [x, y], "pins": "right" },
   "lanes": [{ "in": 93, "out": 94 }] }]
```

- Teeth are ordinary graph reroutes; `lanes[i].in`/`.out` are reroute ids. A
  member link's chain always threads the in-tooth before the out-tooth.
- `collapsed: true` (optional, additive, per-comb) -- both gates draw as
  GATE_W squares, all pins and lanes stack on the centre, the ribbon runs as
  a single line; implicit linking only while collapsed. Absent = expanded.
- `in.labels` / `out.labels: true` (optional, additive) -- that gate renders
  each lane's source label and bulges toward the ribbon side to fit; absent =
  narrow gate. Both gates show the SOURCE names. Label text and width are
  derived at runtime, never serialized.
- Deleting the record (or disabling the extension) leaves the teeth as plain
  reroutes and every link connected: the ribbon decomposes, the wiring stays.

## Node-carried records (v1, in `node.properties`)

These ride the node itself so core's own serialization, cloning and
copy-paste carry them; they are part of the same versioned family.

- `properties["cablemanagement.from"]` on a CONSUMER node:
  `{ "<inputIndex>": [hostNodeId, hostInputIndex, linkId | null, tailRerouteId?] }`
  -- this input was created by dragging the pass-through pin of
  `(host, hostInputIndex)`; `linkId` names the link the record applies to (a
  mismatch means the user rewired by hand and the record is dormant).
  `linkId: null` is severed memory -- a fragment that re-materializes when the
  host pin can provide again; the optional `tailRerouteId` remembers the
  reroute chain's tail for re-threading.
- `properties["cablemanagement.owned"] = true` plus
  `properties["cablemanagement.host"]` / `["cablemanagement.hostSlot"]` on a
  PrimitiveNode: the node is extension-owned machinery republishing the host
  widget's literal. Safe to delete; the host keeps its widget value.
- `properties["cablemanagement.stitchFrom"] = [hostNodeId, hostInputIndex]` on
  a gate-to-gate stitch reroute: the pin the bridging gesture came from
  (drawing only; the stitch works without it).

## Id spaces

Real link ids and floating-link ids are SEPARATE core counters and may
collide numerically. Any table keyed by link id must state which space it
keys; every table above keys real links except `claims.floats`, which keys
reroute ids. Never resolve a floating link through `graph.getLink`.
