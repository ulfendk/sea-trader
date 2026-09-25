import { LAND_H, LAND_MASK_B64, LAND_W } from './data/landmask.js';
import { PORTS, type Port } from './data/ports.js';

export const W = LAND_W;
export const H = LAND_H;
const NM_PER_RAD = 3440.065;

function decodeBase64(b64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(128);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  const clean = b64.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)];
    const b = lookup[clean.charCodeAt(i + 1)];
    const c = lookup[clean.charCodeAt(i + 2)] ?? 0;
    const d = lookup[clean.charCodeAt(i + 3)] ?? 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

export const idx = (x: number, y: number) => y * W + (((x % W) + W) % W);
export const cellX = (lon: number) => ((Math.floor(lon + 180) % W) + W) % W;
export const cellY = (lat: number) => Math.min(H - 1, Math.max(0, Math.floor(90 - lat)));
export const cellLon = (x: number) => -180 + x + 0.5;
export const cellLat = (y: number) => 90 - y - 0.5;

/** Straits too narrow for the 1° grid, forced open. [lon, lat] */
const FORCE_SEA: [number, number][] = [
  // Strait of Gibraltar
  [-6.5, 35.9],
  [-5.5, 35.9],
  [-4.5, 35.9],
  // English Channel / Dover
  [1.5, 51.1],
  [0.5, 50.5],
  [1.5, 50.5],
  // Elbe estuary for Hamburg
  [8.5, 54.0],
  [9.5, 53.9],
  // Bab-el-Mandeb
  [43.4, 12.6],
  [43.4, 13.5],
  // Strait of Hormuz
  [56.5, 26.5],
  [56.5, 25.8],
  [55.5, 26.2],
  // Singapore strait / Malacca
  [103.5, 1.2],
  [104.5, 1.2],
  [102.5, 1.9],
  [101.5, 2.5],
  [100.5, 3.5],
  [99.5, 4.5],
  // Dardanelles not needed; Messina not needed.
];

/** Canal cells (open unless the ship is too large). */
export const CANALS: Record<string, [number, number][]> = {
  suez: [
    [32.5, 31.4],
    [32.5, 30.5],
    [32.5, 29.6],
    [32.5, 28.5],
    [33.5, 28.5],
    [33.5, 27.5],
  ],
  panama: [
    [-79.5, 9.5],
    [-79.5, 8.5],
    [-80.5, 9.5],
  ],
};

const baseLand = decodeBase64(LAND_MASK_B64);
/** 1 = land/blocked, 0 = sea. */
export const LAND = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) LAND[i] = (baseLand[i >> 3] >> (i & 7)) & 1;
// Polar regions are not navigable.
for (let y = 0; y < H; y++) {
  const lat = cellLat(y);
  if (lat > 72 || lat < -66) for (let x = 0; x < W; x++) LAND[y * W + x] = 1;
}
for (const [lon, lat] of FORCE_SEA) LAND[idx(cellX(lon), cellY(lat))] = 0;
export const CANAL_CELL = new Map<number, string>();
for (const [name, cells] of Object.entries(CANALS)) {
  for (const [lon, lat] of cells) {
    const i = idx(cellX(lon), cellY(lat));
    LAND[i] = 0;
    CANAL_CELL.set(i, name);
  }
}

export function isLandCell(x: number, y: number): boolean {
  if (y < 0 || y >= H) return true;
  return LAND[idx(x, y)] === 1;
}

export function haversineNm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * NM_PER_RAD * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Nearest sea cell to each port. */
const PORT_CELL = new Map<string, [number, number]>();
function nearestSea(lon: number, lat: number): [number, number] {
  const sx = cellX(lon);
  const sy = cellY(lat);
  for (let r = 0; r < 6; r++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = sx + dx;
        const y = sy + dy;
        if (isLandCell(x, y)) continue;
        const d = haversineNm(lon, lat, cellLon(((x % W) + W) % W), cellLat(y));
        if (d < bestD) {
          bestD = d;
          best = [((x % W) + W) % W, y];
        }
      }
    if (best) return best;
  }
  throw new Error(`No sea near ${lon},${lat}`);
}
export function portCell(port: Port): [number, number] {
  let c = PORT_CELL.get(port.id);
  if (!c) {
    c = nearestSea(port.lon, port.lat);
    PORT_CELL.set(port.id, c);
  }
  return c;
}

export interface RouteOptions {
  noSuez?: boolean;
  noPanama?: boolean;
}

export interface Route {
  from: string;
  to: string;
  /** Polyline in [lon, lat]; longitudes are unwrapped (may exceed ±180) so it can be drawn continuously. */
  points: [number, number][];
  distance: number;
  canals: string[];
}

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, p: number) {
    this.items.push(item);
    this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.items[0];
    const lastI = this.items.pop()!;
    const lastP = this.prio.pop()!;
    if (this.items.length) {
      this.items[0] = lastI;
      this.prio[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l] < this.prio[m]) m = l;
        if (r < this.items.length && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
  }
}

function blocked(i: number, opts: RouteOptions): boolean {
  if (LAND[i]) return true;
  const canal = CANAL_CELL.get(i);
  if (canal === 'suez' && opts.noSuez) return true;
  if (canal === 'panama' && opts.noPanama) return true;
  return false;
}

/** Cost multiplier: hugging coasts is slightly penalised so routes stay in open water. */
function coastPenalty(x: number, y: number): number {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isLandCell(x + dx, y + dy)) n++;
  return 1 + n * 0.02;
}

function astar(
  start: [number, number],
  goal: [number, number],
  opts: RouteOptions,
): [number, number][] | null {
  const startI = idx(start[0], start[1]);
  const goalI = idx(goal[0], goal[1]);
  const g = new Float64Array(W * H).fill(Infinity);
  const came = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const heap = new MinHeap();
  const gl = cellLon(goal[0]);
  const gt = cellLat(goal[1]);
  g[startI] = 0;
  heap.push(startI, 0);
  while (heap.size) {
    const cur = heap.pop();
    if (cur === goalI) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % W;
    const cy = Math.floor(cur / W);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const ny = cy + dy;
        if (ny < 0 || ny >= H) continue;
        const nx = (cx + dx + W) % W;
        const ni = ny * W + nx;
        if (closed[ni] || (blocked(ni, opts) && ni !== goalI)) continue;
        // no corner cutting through land
        if (dx && dy && blocked(idx(cx + dx, cy), opts) && blocked(idx(cx, cy + dy), opts)) continue;
        const step = haversineNm(cellLon(cx), cellLat(cy), cellLon(nx), cellLat(ny)) * coastPenalty(nx, ny);
        const ng = g[cur] + step;
        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = cur;
          heap.push(ni, ng + haversineNm(cellLon(nx), cellLat(ny), gl, gt));
        }
      }
  }
  if (came[goalI] === -1 && goalI !== startI) return null;
  const path: [number, number][] = [];
  for (let c = goalI; c !== -1; c = came[c]) path.push([c % W, Math.floor(c / W)]);
  return path.reverse();
}

/** Converts a cell path into continuous (unwrapped) grid coordinates. */
function unwrap(path: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let offset = 0;
  for (let i = 0; i < path.length; i++) {
    if (i > 0) {
      const d = path[i][0] - path[i - 1][0];
      if (d > W / 2) offset -= W;
      else if (d < -W / 2) offset += W;
    }
    out.push([path[i][0] + offset, path[i][1]]);
  }
  return out;
}

function lineOfSight(a: [number, number], b: [number, number], opts: RouteOptions): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 4);
  for (let s = 1; s < steps; s++) {
    const x = Math.round(a[0] + (dx * s) / steps);
    const y = Math.round(a[1] + (dy * s) / steps);
    if (blocked(idx(x, y), opts)) return false;
  }
  return true;
}

const routeCache = new Map<string, Route>();

export function routeKey(from: string, to: string, opts: RouteOptions = {}): string {
  return `${from}>${to}${opts.noSuez ? ':ns' : ''}${opts.noPanama ? ':np' : ''}`;
}

export function findRoute(fromPort: Port, toPort: Port, opts: RouteOptions = {}): Route {
  const key = routeKey(fromPort.id, toPort.id, opts);
  const cached = routeCache.get(key);
  if (cached) return cached;
  const raw = astar(portCell(fromPort), portCell(toPort), opts);
  if (!raw) throw new Error(`No sea route ${fromPort.id} -> ${toPort.id}`);
  const canals = new Set<string>();
  for (const [x, y] of raw) {
    const c = CANAL_CELL.get(idx(x, y));
    if (c) canals.add(c);
  }
  const cells = unwrap(raw);
  // String-pulling simplification.
  const simple: [number, number][] = [cells[0]];
  let anchor = 0;
  while (anchor < cells.length - 1) {
    let far = anchor + 1;
    for (let j = cells.length - 1; j > anchor + 1; j--) {
      if (lineOfSight(cells[anchor], cells[j], opts)) {
        far = j;
        break;
      }
    }
    simple.push(cells[far]);
    anchor = far;
  }
  const pts: [number, number][] = simple.map(([x, y]) => [cellLon(x), cellLat(y)]);
  // Replace endpoints with the exact port coordinates (unwrapped to match).
  const fixLon = (lon: number, ref: number) => {
    let l = lon;
    while (l - ref > 180) l -= 360;
    while (ref - l > 180) l += 360;
    return l;
  };
  pts.unshift([fixLon(fromPort.lon, pts[0][0]), fromPort.lat]);
  pts.push([fixLon(toPort.lon, pts[pts.length - 1][0]), toPort.lat]);
  let distance = 0;
  for (let i = 1; i < pts.length; i++)
    distance += haversineNm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  const route: Route = {
    from: fromPort.id,
    to: toPort.id,
    points: pts,
    distance: Math.round(distance),
    canals: [...canals],
  };
  routeCache.set(key, route);
  return route;
}

/** Position along a route polyline after `nm` nautical miles. */
export function pointAlong(route: Route, nm: number): { lon: number; lat: number; heading: number } {
  let left = Math.max(0, nm);
  const pts = route.points;
  for (let i = 1; i < pts.length; i++) {
    const seg = haversineNm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    if (left <= seg || i === pts.length - 1) {
      const t = seg > 0 ? Math.min(1, left / seg) : 1;
      const lon = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t;
      const lat = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
      const heading = Math.atan2(-(pts[i][1] - pts[i - 1][1]), pts[i][0] - pts[i - 1][0]);
      return { lon: ((((lon + 180) % 360) + 360) % 360) - 180, lat, heading };
    }
    left -= seg;
  }
  const last = pts[pts.length - 1];
  return { lon: last[0], lat: last[1], heading: 0 };
}

export function allPortsReachable(): string[] {
  const problems: string[] = [];
  for (const a of PORTS)
    for (const b of PORTS) {
      if (a.id >= b.id) continue;
      try {
        findRoute(a, b);
      } catch (e) {
        problems.push(`${a.id}-${b.id}`);
      }
    }
  return problems;
}
