import { pool, replacePathVariants } from "./storage";

// Seed community_paths from OpenStreetMap via the Overpass API.
//
// Usage:
//   npx tsx server/seed-osm-paths.ts --bbox=37.6,-122.5,37.9,-122.3
//   npx tsx server/seed-osm-paths.ts --region=sf
//
// Re-runnable: rows are upserted on osm_way_id.

const OVERPASS_URLS = (process.env.OVERPASS_URL || [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
].join(",")).split(",");
const MIN_MILES = 0.5;   // drop OSM fragments shorter than this
const MAX_MILES = 40;    // drop unreasonably long relations that bleed off-screen

type LatLng = { latitude: number; longitude: number };
type ActivityType = "run" | "walk" | "ride";

type OverpassElement = {
  type: "way" | "relation" | "node";
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  members?: Array<{
    type: "way" | "node" | "relation";
    ref: number;
    role?: string;
    geometry?: Array<{ lat: number; lon: number }>;
  }>;
};

const REGIONS: Record<string, { name: string; bbox: [number, number, number, number] }> = {
  sf:       { name: "San Francisco Bay Area", bbox: [37.6, -122.55, 37.9, -122.30] },
  nyc:      { name: "New York City",          bbox: [40.55, -74.05,  40.90, -73.70] },
  la:       { name: "Los Angeles",            bbox: [33.90, -118.55, 34.25, -118.15] },
  chicago:  { name: "Chicago",                bbox: [41.70, -87.85,  42.05, -87.55] },
  london:   { name: "London",                 bbox: [51.40, -0.35,   51.60,  0.10] },
  katy:     { name: "Katy, TX",               bbox: [29.70, -95.95,  29.85, -95.68] },
};

function haversineMiles(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const la1 = (a.latitude * Math.PI) / 180;
  const la2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pathMiles(pts: LatLng[]): number {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += haversineMiles(pts[i - 1], pts[i]);
  return m;
}

function classifyActivities(tags: Record<string, string>): ActivityType[] {
  const h = tags.highway || "";
  const route = tags.route || "";
  const set = new Set<ActivityType>();

  const accessOk = tags.access !== "no" && tags.access !== "private";
  const footBlocked = tags.foot === "no" || !accessOk;
  const bikeBlocked = tags.bicycle === "no" || !accessOk;

  // Route relations (highest-quality signals)
  if (route === "bicycle" || route === "mtb") set.add("ride");
  if (route === "foot" || route === "hiking" || route === "walking") { set.add("walk"); set.add("run"); }
  if (route === "running") { set.add("run"); set.add("walk"); }

  // Implied defaults by highway type
  if (h === "cycleway") set.add("ride");
  if (h === "path" || h === "track" || h === "bridleway") {
    if (!footBlocked) { set.add("walk"); set.add("run"); }
    if (!bikeBlocked) set.add("ride");
  }
  if (h === "footway" || h === "pedestrian") {
    if (!footBlocked) { set.add("walk"); set.add("run"); }
  }

  // Explicit access tags override highway defaults (multi-use trails, shared paths).
  // E.g. highway=cycleway + foot=designated = shared bike/foot path.
  const footYes = tags.foot === "designated" || tags.foot === "yes" || tags.foot === "permissive";
  const bikeYes = tags.bicycle === "designated" || tags.bicycle === "yes" || tags.bicycle === "permissive";
  if (footYes && !footBlocked) { set.add("walk"); set.add("run"); }
  if (bikeYes && !bikeBlocked) set.add("ride");

  // Hard blocks win
  if (footBlocked) { set.delete("walk"); set.delete("run"); }
  if (bikeBlocked) set.delete("ride");

  return Array.from(set);
}

function nameFor(tags: Record<string, string>, region: string): string {
  const n = tags.name || tags["name:en"] || tags.ref;
  if (n) return n;
  const h = tags.highway;
  const base =
    h === "cycleway" ? "Cycle path" :
    h === "footway" ? "Footpath" :
    h === "pedestrian" ? "Pedestrian way" :
    h === "path" ? "Trail" :
    h === "track" ? "Track" :
    "Path";
  return `${base} — ${region}`;
}

async function fetchOverpass(bbox: [number, number, number, number]): Promise<OverpassElement[]> {
  const [s, w, n, e] = bbox;
  // Selective: only curated routes.
  //   1. Route relations (hiking/cycling/foot/running/mtb) — real curated trails
  //   2. Named paths/tracks/bridleways/cycleways (named == someone bothered to name it, usually a real route)
  //   3. Ways inside parks (leisure=park, boundary=national_park) — park paths
  // Pull named + unnamed ways. Unnamed ways get attached as connectors to
  // named groups if their endpoints sit within snap distance of a named group's
  // nodes (handles OSM's common "unnamed bridge between two named segments").
  const query = `
    [out:json][timeout:180];
    (
      relation["route"~"^(bicycle|mtb|foot|hiking|running|walking)$"](${s},${w},${n},${e});
      way["highway"~"^(path|track|bridleway|cycleway|footway|pedestrian)$"](${s},${w},${n},${e});
    );
    out geom;
  `.trim();

  console.log(`[osm] Fetching bbox ${bbox.join(",")}…`);
  let lastErr: Error | null = null;
  for (const url of OVERPASS_URLS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "PaceUp/1.0 (https://paceup.app; contact: matpeacock9@gmail.com)",
            "Accept": "application/json",
          },
          body: "data=" + encodeURIComponent(query),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`Overpass HTTP ${res.status} @ ${url}: ${text.slice(0, 200)}`);
        if (text.trim().startsWith("<")) throw new Error(`Overpass returned HTML (likely rate-limited/busy) @ ${url}: ${text.slice(0, 200)}`);
        const json = JSON.parse(text) as { elements: OverpassElement[] };
        return (json.elements || []).filter((el) =>
          (el.type === "way" && el.geometry && el.geometry.length >= 2) ||
          (el.type === "relation" && el.members && el.members.length > 0)
        );
      } catch (e) {
        lastErr = e as Error;
        console.warn(`[osm] ${url} attempt ${attempt} failed: ${(e as Error).message.slice(0, 120)}`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
  throw lastErr ?? new Error("All Overpass mirrors failed");
}

type Variant = {
  name: string;
  pts: LatLng[];
  miles: number;
};

type Candidate = {
  osmId: number;
  name: string;
  pts: LatLng[];
  miles: number;
  activities: ActivityType[];
  variants: Variant[];
};

async function upsertCandidate(c: Candidate): Promise<"inserted" | "updated" | "skipped"> {
  if (c.miles < MIN_MILES || c.miles > MAX_MILES) return "skipped";
  if (c.activities.length === 0) return "skipped";

  const start = c.pts[0], end = c.pts[c.pts.length - 1];
  const primary: ActivityType = c.activities.includes("run") ? "run" : c.activities[0];

  let parentId: string;
  const existing = await pool.query(`SELECT id FROM community_paths WHERE osm_way_id = $1`, [c.osmId]);
  let kind: "inserted" | "updated";
  if (existing.rows.length > 0) {
    parentId = existing.rows[0].id;
    await pool.query(
      `UPDATE community_paths SET
         name = $2, route_path = $3, distance_miles = $4,
         start_lat = $5, start_lng = $6, end_lat = $7, end_lng = $8,
         activity_type = $9, activity_types = $10, updated_at = NOW()
       WHERE osm_way_id = $1`,
      [c.osmId, c.name, JSON.stringify(c.pts), c.miles, start.latitude, start.longitude, end.latitude, end.longitude, primary, c.activities]
    );
    kind = "updated";
  } else {
    const inserted = await pool.query(
      `INSERT INTO community_paths
        (name, route_path, distance_miles, is_public, created_by_user_id, created_by_name,
         start_lat, start_lng, end_lat, end_lng, activity_type, activity_types, run_count, osm_way_id)
       VALUES ($1, $2, $3, true, NULL, 'OpenStreetMap', $4, $5, $6, $7, $8, $9, 0, $10)
       RETURNING id`,
      [c.name, JSON.stringify(c.pts), c.miles, start.latitude, start.longitude, end.latitude, end.longitude, primary, c.activities, c.osmId]
    );
    parentId = inserted.rows[0].id;
    kind = "inserted";
  }

  const variantsToWrite = c.variants
    .filter((v) => v.miles >= 0.2 && v.miles <= MAX_MILES && v.pts.length >= 2)
    .map((v) => ({ name: v.name, route_path: v.pts, distance_miles: v.miles, activity_types: c.activities }));
  await replacePathVariants(parentId, variantsToWrite);
  return kind;
}

// --- Graph-based decomposition ---
// Each way in a name-group contributes edges between consecutive OSM nodes.
// Coordinate string is the node key (shared OSM nodes have identical coords, so exact match works).
// We:
//   1. Dedupe parallel edges (fixes "same loop traced 3x" double-counting).
//   2. Split disconnected pieces into separate parent rows (fixes east/west pond-cutting).
//   3. For each component, build a contiguous polyline via DFS (backtracking where needed)
//      and compute unique-edge distance separately.
//   4. Detect simple cycles in the component and expose them as route variants.

type NodeKey = string;
type Edge = { a: NodeKey; b: NodeKey; len: number };
type Graph = {
  nodes: Map<NodeKey, LatLng>;
  adj: Map<NodeKey, Array<{ to: NodeKey; edgeIdx: number }>>;
  edges: Edge[];
};

const nodeKey = (p: { lat: number; lon: number }) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;

function buildGraph(ways: OverpassElement[]): Graph {
  const nodes = new Map<NodeKey, LatLng>();
  const edges: Edge[] = [];
  const edgeSet = new Set<string>();
  const adj = new Map<NodeKey, Array<{ to: NodeKey; edgeIdx: number }>>();

  const addAdj = (from: NodeKey, to: NodeKey, idx: number) => {
    const arr = adj.get(from) ?? [];
    arr.push({ to, edgeIdx: idx });
    adj.set(from, arr);
  };

  for (const w of ways) {
    const geom = w.geometry;
    if (!geom || geom.length < 2) continue;
    for (let i = 0; i < geom.length - 1; i++) {
      const p1 = geom[i], p2 = geom[i + 1];
      if (p1.lat === p2.lat && p1.lon === p2.lon) continue;
      const k1 = nodeKey(p1), k2 = nodeKey(p2);
      nodes.set(k1, { latitude: p1.lat, longitude: p1.lon });
      nodes.set(k2, { latitude: p2.lat, longitude: p2.lon });
      const canonical = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      if (edgeSet.has(canonical)) continue; // dedupe parallel edges
      edgeSet.add(canonical);
      const len = haversineMiles(nodes.get(k1)!, nodes.get(k2)!);
      const idx = edges.length;
      edges.push({ a: k1, b: k2, len });
      addAdj(k1, k2, idx);
      addAdj(k2, k1, idx);
    }
  }
  return { nodes, adj, edges };
}

// Merge each degree-1 endpoint node into the nearest other node within
// `thresholdMiles` (~65m). OSM frequently draws adjacent way segments whose
// endpoints differ by a few meters at shared junctions (they don't share a
// node id). Without this, our exact-coord key leaves those as disconnected
// endpoints. Threshold is small enough not to bridge genuinely separate
// trails (east/west clusters are miles apart), but big enough to close the
// tiny drafting-gaps within a single named trail.
function snapNearEndpoints(g: Graph, thresholdMiles = 0.04): void {
  const endpoints = Array.from(g.nodes.keys()).filter((k) => (g.adj.get(k) ?? []).length === 1);
  if (endpoints.length === 0) return;
  const remap = new Map<NodeKey, NodeKey>();
  for (const k of endpoints) {
    const p = g.nodes.get(k)!;
    let best: { to: NodeKey; d: number } | null = null;
    for (const [ok, op] of g.nodes) {
      if (ok === k) continue;
      if (Math.abs(op.latitude - p.latitude) > 0.001) continue; // ~110m lat prefilter
      if (Math.abs(op.longitude - p.longitude) > 0.001) continue;
      const d = haversineMiles(p, op);
      if (d > thresholdMiles) continue;
      if (!best || d < best.d) best = { to: ok, d };
    }
    if (best) remap.set(k, best.to);
  }
  if (remap.size === 0) return;
  // Resolve chains (with cycle guard — two endpoints can map to each other).
  for (const from of Array.from(remap.keys())) {
    let t = remap.get(from)!;
    const seen = new Set<NodeKey>([from]);
    while (remap.has(t) && !seen.has(t)) {
      seen.add(t);
      t = remap.get(t)!;
    }
    remap.set(from, t);
  }
  // Rewrite edges.
  for (const e of g.edges) {
    if (remap.has(e.a)) e.a = remap.get(e.a)!;
    if (remap.has(e.b)) e.b = remap.get(e.b)!;
  }
  // Drop self-loops + duplicate edges created by the merge.
  const seen = new Set<string>();
  const kept: Edge[] = [];
  for (const e of g.edges) {
    if (e.a === e.b) continue;
    const sig = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    kept.push(e);
  }
  g.edges.length = 0;
  g.edges.push(...kept);
  for (const [from, to] of remap) if (from !== to) g.nodes.delete(from);
  g.adj.clear();
  g.edges.forEach((e, idx) => {
    const a = g.adj.get(e.a) ?? [];
    a.push({ to: e.b, edgeIdx: idx });
    g.adj.set(e.a, a);
    const b = g.adj.get(e.b) ?? [];
    b.push({ to: e.a, edgeIdx: idx });
    g.adj.set(e.b, b);
  });
}

// Within a named group, trust the name: if multiple components exist, bridge the
// closest inter-component endpoint pair iteratively until one component remains
// or no gap is within `maxBridgeMiles`. Covers the OSM case where two segments
// of the same trail have different highway tags and don't share a node — their
// endpoints are close (~10s of meters) but further apart than the 65m snap
// threshold allows globally.
function bridgeNamedComponents(g: Graph, maxBridgeMiles = 0.5, debugName = ""): number {
  let bridges = 0;
  for (let iter = 0; iter < 20; iter++) {
    const comps = connectedComponents(g);
    if (comps.length <= 1) break;
    let best: { a: NodeKey; b: NodeKey; d: number } | null = null;
    for (let i = 0; i < comps.length; i++) {
      for (let j = i + 1; j < comps.length; j++) {
        for (const na of comps[i]) {
          const pa = g.nodes.get(na);
          if (!pa) continue;
          for (const nb of comps[j]) {
            const pb = g.nodes.get(nb);
            if (!pb) continue;
            const d = haversineMiles(pa, pb);
            if (!best || d < best.d) best = { a: na, b: nb, d };
          }
        }
      }
    }
    if (debugName && iter === 0) {
      const gap = best ? `${best.d.toFixed(3)}mi` : "n/a";
      console.log(`[osm] "${debugName}": ${comps.length} components, closest inter-component gap ${gap}`);
    }
    if (!best || best.d > maxBridgeMiles) break;
    const idx = g.edges.length;
    g.edges.push({ a: best.a, b: best.b, len: best.d });
    const aAdj = g.adj.get(best.a) ?? [];
    aAdj.push({ to: best.b, edgeIdx: idx });
    g.adj.set(best.a, aAdj);
    const bAdj = g.adj.get(best.b) ?? [];
    bAdj.push({ to: best.a, edgeIdx: idx });
    g.adj.set(best.b, bAdj);
    bridges++;
  }
  return bridges;
}

function connectedComponents(g: Graph): NodeKey[][] {
  const seen = new Set<NodeKey>();
  const comps: NodeKey[][] = [];
  for (const start of g.nodes.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    const comp: NodeKey[] = [];
    seen.add(start);
    while (stack.length) {
      const n = stack.pop()!;
      if (!g.nodes.has(n)) continue; // defensive: skip stale refs
      comp.push(n);
      for (const { to } of g.adj.get(n) ?? []) {
        if (!seen.has(to) && g.nodes.has(to)) { seen.add(to); stack.push(to); }
      }
    }
    if (comp.length > 0) comps.push(comp);
  }
  return comps;
}

// DFS walk visiting every edge in the component exactly once in traversal order.
// Branches force backtracking — the returned polyline retraces those, which is
// visually continuous. Distance is computed from unique edges, not the polyline.
function walkComponent(g: Graph, nodesInComp: NodeKey[]): LatLng[] {
  const compSet = new Set(nodesInComp);
  // Start at a degree-1 node if one exists, else any node.
  let start = nodesInComp[0];
  for (const n of nodesInComp) {
    const deg = (g.adj.get(n) ?? []).length;
    if (deg === 1) { start = n; break; }
  }
  const totalEdges = g.edges.filter((e) => compSet.has(e.a) && compSet.has(e.b)).length;
  const usedEdges = new Set<number>();
  const out: LatLng[] = [g.nodes.get(start)!];
  const stack: NodeKey[] = [start];
  let cur = start;
  while (usedEdges.size < totalEdges) {
    const neighbors = g.adj.get(cur) ?? [];
    const next = neighbors.find((n) => !usedEdges.has(n.edgeIdx) && compSet.has(n.to));
    if (next) {
      usedEdges.add(next.edgeIdx);
      stack.push(next.to);
      out.push(g.nodes.get(next.to)!);
      cur = next.to;
    } else {
      stack.pop();
      if (stack.length === 0) break;
      cur = stack[stack.length - 1];
      out.push(g.nodes.get(cur)!);
    }
  }
  return out;
}

function componentMiles(g: Graph, nodesInComp: NodeKey[]): number {
  const set = new Set(nodesInComp);
  let m = 0;
  for (const e of g.edges) if (set.has(e.a) && set.has(e.b)) m += e.len;
  return m;
}

function componentCentroid(g: Graph, nodesInComp: NodeKey[]): LatLng {
  let lat = 0, lng = 0;
  for (const k of nodesInComp) {
    const p = g.nodes.get(k)!;
    lat += p.latitude; lng += p.longitude;
  }
  return { latitude: lat / nodesInComp.length, longitude: lng / nodesInComp.length };
}

// Compass suffix for disambiguating multiple components of the same name group.
// Picks the dominant axis (lat range vs lng range) and splits.
function compassSuffixes(g: Graph, comps: NodeKey[][]): string[] {
  if (comps.length <= 1) return comps.map(() => "");
  const centroids = comps.map((c) => componentCentroid(g, c));
  const latMin = Math.min(...centroids.map((c) => c.latitude));
  const latMax = Math.max(...centroids.map((c) => c.latitude));
  const lngMin = Math.min(...centroids.map((c) => c.longitude));
  const lngMax = Math.max(...centroids.map((c) => c.longitude));
  const useLng = (lngMax - lngMin) >= (latMax - latMin);
  if (useLng) {
    const mid = (lngMin + lngMax) / 2;
    return centroids.map((c) => (c.longitude >= mid ? "East" : "West"));
  }
  const mid = (latMin + latMax) / 2;
  return centroids.map((c) => (c.latitude >= mid ? "North" : "South"));
}

// Find simple cycles inside a component. Uses DFS; collects fundamental cycles
// when a back-edge is encountered. Produces at most `maxCycles` unique cycles,
// deduped by their edge-set signature.
function findCycles(g: Graph, nodesInComp: NodeKey[], maxCycles = 4): Array<{ pts: LatLng[]; miles: number }> {
  const compSet = new Set(nodesInComp);
  const cycles: Array<{ pts: LatLng[]; miles: number; sig: string }> = [];
  const seenSigs = new Set<string>();
  const parent = new Map<NodeKey, NodeKey | null>();
  const parentEdge = new Map<NodeKey, number>();
  const visited = new Set<NodeKey>();

  function recordCycle(from: NodeKey, to: NodeKey, edgeIdx: number) {
    // Walk up parents from `from` back to `to`; that path + the closing edge = cycle.
    const path: NodeKey[] = [from];
    let cur: NodeKey | null = from;
    while (cur !== null && cur !== to) {
      cur = parent.get(cur) ?? null;
      if (cur !== null) path.push(cur);
    }
    if (cur !== to) return;
    const edgeIds = new Set<number>([edgeIdx]);
    for (let i = 0; i < path.length - 1; i++) {
      const ei = parentEdge.get(path[i]);
      if (ei !== undefined) edgeIds.add(ei);
    }
    const sig = Array.from(edgeIds).sort((a, b) => a - b).join(",");
    if (seenSigs.has(sig)) return;
    seenSigs.add(sig);
    // Build polyline & distance
    const pts: LatLng[] = path.map((k) => g.nodes.get(k)!);
    pts.push(g.nodes.get(to)!); // close the loop
    let miles = 0;
    for (const ei of edgeIds) miles += g.edges[ei].len;
    cycles.push({ pts, miles, sig });
  }

  function dfs(start: NodeKey) {
    const stack: Array<{ node: NodeKey; nextIdx: number }> = [{ node: start, nextIdx: 0 }];
    visited.add(start);
    parent.set(start, null);
    while (stack.length && cycles.length < maxCycles) {
      const top = stack[stack.length - 1];
      const neighbors = g.adj.get(top.node) ?? [];
      if (top.nextIdx >= neighbors.length) { stack.pop(); continue; }
      const { to, edgeIdx } = neighbors[top.nextIdx++];
      if (!compSet.has(to)) continue;
      // Skip the edge we came from
      if (parentEdge.get(top.node) === edgeIdx) continue;
      if (visited.has(to)) {
        recordCycle(top.node, to, edgeIdx);
        continue;
      }
      visited.add(to);
      parent.set(to, top.node);
      parentEdge.set(to, edgeIdx);
      stack.push({ node: to, nextIdx: 0 });
    }
  }

  for (const n of nodesInComp) {
    if (cycles.length >= maxCycles) break;
    if (!visited.has(n)) dfs(n);
  }
  return cycles.map(({ pts, miles }) => ({ pts, miles }));
}

function cycleCompassName(g: Graph, cyclePts: LatLng[], componentCenter: LatLng): string {
  let lat = 0, lng = 0;
  for (const p of cyclePts) { lat += p.latitude; lng += p.longitude; }
  lat /= cyclePts.length; lng /= cyclePts.length;
  const dLat = lat - componentCenter.latitude;
  const dLng = lng - componentCenter.longitude;
  if (Math.abs(dLng) > Math.abs(dLat)) return dLng >= 0 ? "East loop" : "West loop";
  return dLat >= 0 ? "North loop" : "South loop";
}

function decomposeGroup(
  ways: OverpassElement[],
  baseName: string,
  activities: ActivityType[]
): Candidate[] {
  const g = buildGraph(ways);
  if (g.edges.length === 0) return [];
  // Within a name-group we trust the name — use a larger snap threshold (240m)
  // than the default (65m). Catches endpoints like the bike↔run tag transition
  // where OSM has two ways that don't share a node but are close enough to be
  // the same physical trail.
  snapNearEndpoints(g, 0.15);
  const bridgeCount = bridgeNamedComponents(g, 0.5, baseName);
  if (bridgeCount > 0) console.log(`[osm] "${baseName}": bridged ${bridgeCount} component gap(s)`);
  const comps = connectedComponents(g);
  const suffixes = compassSuffixes(g, comps);
  const results: Candidate[] = [];
  for (let i = 0; i < comps.length; i++) {
    const comp = comps[i];
    const miles = componentMiles(g, comp);
    if (miles < MIN_MILES) continue;
    const pts = walkComponent(g, comp);
    if (pts.length < 2) continue;
    const suffix = suffixes[i];
    const name = suffix ? `${baseName} (${suffix})` : baseName;
    // Use the smallest way-id in this component for a stable osm dedup key.
    const compSet = new Set(comp);
    const waysInComp = ways.filter((w) =>
      (w.geometry ?? []).some((p) => compSet.has(nodeKey(p)))
    );
    const osmId = waysInComp.length ? Math.min(...waysInComp.map((w) => w.id)) : -1;

    const center = componentCentroid(g, comp);
    const cycles = findCycles(g, comp);
    const variants: Variant[] = [];
    if (cycles.length > 0) {
      variants.push({ name: "Full", pts, miles });
      const seenNames = new Set<string>();
      for (const c of cycles) {
        if (c.miles < 0.2) continue;
        let vn = cycleCompassName(g, c.pts, center);
        let n = 2;
        while (seenNames.has(vn)) { vn = `${vn.replace(/ \d+$/, "")} ${n++}`; }
        seenNames.add(vn);
        variants.push({ name: vn, pts: c.pts, miles: c.miles });
      }
    }
    results.push({ osmId, name, pts, miles, activities, variants });
  }
  return results;
}

export async function seedOsmForBbox(
  bbox: [number, number, number, number],
  regionName: string,
  opts: { nameFilter?: string } = {}
) {
  const elements = await fetchOverpass(bbox);
  const rels = elements.filter((e) => e.type === "relation");
  const ways = elements.filter((e) => e.type === "way");
  console.log(`[osm] Got ${rels.length} route relations + ${ways.length} named ways`);

  // Ways that are members of route relations — we fold them into the parent relation.
  const wayIdsInRelations = new Set<number>();
  for (const r of rels) for (const m of r.members || []) if (m.type === "way") wayIdsInRelations.add(m.ref);

  const candidates: Candidate[] = [];

  // 1. Route relations → decompose via graph (same as named ways, but edges come from member ways)
  for (const r of rels) {
    const tags = r.tags || {};
    const activities = classifyActivities(tags);
    if (activities.length === 0) continue;
    const memberWays: OverpassElement[] = (r.members || [])
      .filter((m) => m.type === "way" && m.geometry && m.geometry.length >= 2)
      .map((m) => ({ type: "way" as const, id: m.ref, geometry: m.geometry }));
    if (memberWays.length === 0) continue;
    const name = nameFor(tags, regionName);
    const parts = decomposeGroup(memberWays, name, activities);
    // Use -relation.id as base so multiple components within a relation still get unique ids
    parts.forEach((c, idx) => candidates.push({ ...c, osmId: -(r.id * 100 + idx) }));
  }

  // 2. Standalone named ways — group by normalized name ONLY (not name+highway)
  //    so a trail whose segments are tagged with different highway values
  //    (e.g. one side cycleway, other side path) still stitch together.
  //    Multi-segment trails (OSM splits one trail across many ways at every
  //    crossing) all collapse into one named group.
  const groups = new Map<string, OverpassElement[]>();
  for (const w of ways) {
    if (wayIdsInRelations.has(w.id)) continue;
    if (!w.geometry || w.geometry.length < 2) continue;
    const tags = w.tags || {};
    const activities = classifyActivities(tags);
    if (activities.length === 0) continue;
    const rawName = tags.name || tags["name:en"] || tags.ref || "";
    if (!rawName) continue;
    const key = rawName.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(w);
  }

  // 2b. Absorb unnamed connector ways: any unnamed path/cycleway/footway
  //     whose endpoint sits within snap distance of a named group's nodes.
  //     Handles the common OSM case where a trail has an unnamed bridge or
  //     short connector between two named segments — without this, the graph
  //     treats the named segments as disconnected.
  const SNAP_MILES = 0.04; // ~65m, same as snapNearEndpoints
  const groupNodes = new Map<string, Set<NodeKey>>();
  const groupNodeList = new Map<string, LatLng[]>();
  for (const [key, group] of groups) {
    const set = new Set<NodeKey>();
    const list: LatLng[] = [];
    for (const gw of group) {
      for (const p of gw.geometry ?? []) {
        const k = nodeKey(p);
        if (!set.has(k)) { set.add(k); list.push({ latitude: p.lat, longitude: p.lon }); }
      }
    }
    groupNodes.set(key, set);
    groupNodeList.set(key, list);
  }
  // Only accept SHORT unnamed connectors of trail-like highway types. Footway
  // and pedestrian are excluded — in urban bboxes they're mostly residential
  // sidewalks and chaining them blows up trails into residential-street blobs.
  // Single pass only (no unnamed→unnamed chaining) for the same reason.
  const MAX_CONNECTOR_MILES = 0.25;
  const unnamedWays = ways.filter((w) => {
    if (wayIdsInRelations.has(w.id)) return false;
    if (!w.geometry || w.geometry.length < 2) return false;
    const tags = w.tags || {};
    const rawName = tags.name || tags["name:en"] || tags.ref || "";
    if (rawName) return false;
    if (!tags.highway || !/^(path|track|bridleway|cycleway)$/.test(tags.highway)) return false;
    // Length check
    const pts = w.geometry.map((p) => ({ latitude: p.lat, longitude: p.lon }));
    return pathMiles(pts) <= MAX_CONNECTOR_MILES;
  });

  let totalAttached = 0;
  for (const w of unnamedWays) {
    const geom = w.geometry!;
    const endpoints = [geom[0], geom[geom.length - 1]];
    let bestKey: string | null = null;
    let bestDist = Infinity;
    for (const [key, list] of groupNodeList) {
      for (const ep of endpoints) {
        for (const np of list) {
          if (Math.abs(np.latitude - ep.lat) > 0.001) continue;
          if (Math.abs(np.longitude - ep.lon) > 0.001) continue;
          const d = haversineMiles({ latitude: ep.lat, longitude: ep.lon }, np);
          if (d < bestDist && d <= SNAP_MILES) { bestDist = d; bestKey = key; }
        }
      }
    }
    if (bestKey) {
      groups.get(bestKey)!.push(w);
      totalAttached++;
    }
  }
  console.log(`[osm] Attached ${totalAttached} unnamed connector ways (single pass)`);

  for (const [, group] of groups) {
    // Merge tags (use any way's tags for name; union of tags for activity classification)
    const mergedTags: Record<string, string> = {};
    for (const w of group) Object.assign(mergedTags, w.tags || {});
    const activities = classifyActivities(mergedTags);
    if (activities.length === 0) continue;
    const baseName = nameFor(mergedTags, regionName);
    const parts = decomposeGroup(group, baseName, activities);
    for (const c of parts) candidates.push(c);
  }

  // Cross-candidate compass disambiguation: any candidates sharing a base name
  // (e.g. one from the route relation + one from the name-group) get East/West/
  // North/South suffixes based on their centroid spread.
  const byName = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const arr = byName.get(c.name) ?? [];
    arr.push(c);
    byName.set(c.name, arr);
  }
  for (const [, group] of byName) {
    if (group.length < 2) continue;
    const centroids = group.map((c) => {
      let lat = 0, lng = 0;
      for (const p of c.pts) { lat += p.latitude; lng += p.longitude; }
      return { latitude: lat / c.pts.length, longitude: lng / c.pts.length };
    });
    const latSpread = Math.max(...centroids.map((c) => c.latitude)) - Math.min(...centroids.map((c) => c.latitude));
    const lngSpread = Math.max(...centroids.map((c) => c.longitude)) - Math.min(...centroids.map((c) => c.longitude));
    const useLng = lngSpread >= latSpread;
    const mid = useLng
      ? (Math.min(...centroids.map((c) => c.longitude)) + Math.max(...centroids.map((c) => c.longitude))) / 2
      : (Math.min(...centroids.map((c) => c.latitude)) + Math.max(...centroids.map((c) => c.latitude))) / 2;
    group.forEach((c, i) => {
      const side = useLng
        ? (centroids[i].longitude >= mid ? "East" : "West")
        : (centroids[i].latitude >= mid ? "North" : "South");
      c.name = `${c.name} (${side})`;
    });
  }

  let filtered = candidates;
  if (opts.nameFilter) {
    const needle = opts.nameFilter.toLowerCase();
    filtered = candidates.filter((c) => c.name.toLowerCase().includes(needle));
    console.log(`[osm] name-filter "${opts.nameFilter}" → ${filtered.length}/${candidates.length} candidates`);
    if (filtered.length === 0) {
      console.log(`[osm] all candidate names found in bbox:`);
      for (const c of candidates) console.log(`    ${c.name} (${c.miles.toFixed(2)}mi)`);
    } else {
      for (const c of filtered) console.log(`  • ${c.name} (${c.miles.toFixed(2)}mi, ${c.variants.length} variants)`);
    }
  }
  console.log(`[osm] ${filtered.length} candidates after filtering`);

  let ins = 0, upd = 0, skip = 0, err = 0;
  for (const c of filtered) {
    try {
      const r = await upsertCandidate(c);
      if (r === "inserted") ins++;
      else if (r === "updated") upd++;
      else skip++;
    } catch (e) {
      err++;
      if (err <= 3) console.warn(`[osm] upsert failed for ${c.osmId}:`, (e as Error).message);
    }
  }
  console.log(`[osm] ${regionName}: inserted=${ins} updated=${upd} skipped=${skip} errors=${err}`);
  return { inserted: ins, updated: upd, skipped: skip, errors: err };
}

async function main() {
  const args = process.argv.slice(2);
  const bboxArg = args.find((a) => a.startsWith("--bbox="))?.split("=")[1];
  const regionArg = args.find((a) => a.startsWith("--region="))?.split("=")[1];
  const nameFilter = args.find((a) => a.startsWith("--name-filter="))?.split("=")[1];

  if (bboxArg) {
    const parts = bboxArg.split(",").map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) {
      throw new Error("--bbox requires 4 comma-separated numbers: south,west,north,east");
    }
    await seedOsmForBbox(parts as [number, number, number, number], "Custom region", { nameFilter });
  } else if (regionArg) {
    const r = REGIONS[regionArg];
    if (!r) throw new Error(`Unknown region '${regionArg}'. Known: ${Object.keys(REGIONS).join(", ")}`);
    await seedOsmForBbox(r.bbox, r.name, { nameFilter });
  } else {
    console.log("Usage: npx tsx server/seed-osm-paths.ts --bbox=S,W,N,E | --region=<key>");
    console.log("Known regions:", Object.keys(REGIONS).join(", "));
    process.exit(1);
  }

  await pool.end();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
