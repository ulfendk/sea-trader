import { Rng } from '../rng.js';
import {
  COLS,
  DIRS,
  KEY_DOWN,
  KEY_LEFT,
  KEY_RIGHT,
  KEY_UP,
  ROWS,
  SUB,
  TILE,
  decodeInputs,
  idiv,
} from './common.js';

/** Harbour steering mini-game: bring the ship into the berth without tugs. */

export const HARBOR_MAX_FRAMES = 30 * 90;
export const HARBOR_MAX_COLLISIONS = 6;

export const T_SEA = 0;
export const T_LAND = 1;
export const T_ROCK = 2;
export const T_BERTH = 3;
export const T_BOAT = 4;

export interface HarborLayout {
  tiles: number[]; // COLS * ROWS
  startX: number; // px
  startY: number; // px
  berth: { x: number; y: number; w: number; h: number }; // tiles
}

export interface HarborState {
  frame: number;
  x: number; // sub-pixels
  y: number;
  heading: number; // 0..31
  speed: number; // sub-pixels per frame
  throttle: number; // -1..3
  turnAcc: number;
  collisions: number;
  cooldown: number;
  prevKeys: number;
  result: 'playing' | 'docked' | 'crashed' | 'timeout';
}

const THROTTLE_SPEED = [-32, 0, 32, 64, 96]; // index throttle+1
const TURN_COST = 480;
const HALF_LEN = 10; // px from centre to bow/stern

function fill(tiles: number[], x0: number, y0: number, w: number, h: number, t: number) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < COLS && y < ROWS) tiles[y * COLS + x] = t;
}

function reachable(layout: HarborLayout): boolean {
  // BFS with 1-tile clearance from entrance to berth.
  const free = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || xx >= COLS || yy >= ROWS) return false;
        if (yy < 0) continue;
        const t = layout.tiles[yy * COLS + xx];
        if (t !== T_SEA && t !== T_BERTH) return false;
      }
    return true;
  };
  const sx = Math.floor(layout.startX / TILE);
  const sy = ROWS - 2;
  const seen = new Uint8Array(COLS * ROWS);
  const q: [number, number][] = [[sx, sy]];
  seen[sy * COLS + sx] = 1;
  const b = layout.berth;
  while (q.length) {
    const [x, y] = q.shift()!;
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h + 1) return true;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || seen[ny * COLS + nx]) continue;
      if (!free(nx, ny) && !(nx >= b.x && nx < b.x + b.w && ny >= b.y && ny < b.y + b.h)) continue;
      seen[ny * COLS + nx] = 1;
      q.push([nx, ny]);
    }
  }
  return false;
}

export function harborLayout(seed: number): HarborLayout {
  for (let attempt = 0; attempt < 50; attempt++) {
    const rng = new Rng(seed + attempt * 7919);
    const tiles = new Array(COLS * ROWS).fill(T_SEA);
    // Outer walls
    fill(tiles, 0, 0, COLS, 2, T_LAND);
    fill(tiles, 0, 0, 2, ROWS, T_LAND);
    fill(tiles, COLS - 2, 0, 2, ROWS, T_LAND);
    // Breakwater along the bottom with an entrance gap.
    const gapW = rng.int(6, 8);
    const gapX = rng.int(4, COLS - 4 - gapW);
    fill(tiles, 0, ROWS - 2, gapX, 2, T_LAND);
    fill(tiles, gapX + gapW, ROWS - 2, COLS - gapX - gapW, 2, T_LAND);
    // Berth: a notch in the top quay.
    const bw = 4;
    const bh = 5;
    const bx = rng.int(4, COLS - 4 - bw);
    fill(tiles, 2, 2, COLS - 4, 2, T_LAND);
    fill(tiles, bx, 2, bw, 2, T_BERTH);
    fill(tiles, bx, 4, bw, bh - 2, T_BERTH);
    // Piers from the sides.
    const piers = rng.int(2, 3);
    for (let i = 0; i < piers; i++) {
      const y = 8 + i * 5 + rng.int(0, 2);
      const len = rng.int(8, 15);
      if (rng.chance(0.5)) fill(tiles, 2, y, len, 2, T_LAND);
      else fill(tiles, COLS - 2 - len, y, len, 2, T_LAND);
    }
    // Moored boats and rocks.
    for (let i = 0; i < rng.int(1, 3); i++)
      fill(tiles, rng.int(3, COLS - 9), rng.int(6, ROWS - 6), rng.int(4, 6), 2, T_BOAT);
    for (let i = 0; i < rng.int(2, 5); i++)
      fill(tiles, rng.int(3, COLS - 4), rng.int(6, ROWS - 5), 1, 1, T_ROCK);
    // Keep the berth approach clear.
    fill(tiles, bx - 1, 4 + bh - 2, bw + 2, 3, T_SEA);
    fill(tiles, bx, 2, bw, bh, T_BERTH);
    // Keep entrance clear.
    fill(tiles, gapX, ROWS - 5, gapW, 3, T_SEA);
    const layout: HarborLayout = {
      tiles,
      startX: (gapX + gapW / 2) * TILE,
      startY: (ROWS - 1) * TILE,
      berth: { x: bx, y: 2, w: bw, h: bh },
    };
    if (reachable(layout)) return layout;
  }
  // Fallback: open harbour.
  const tiles = new Array(COLS * ROWS).fill(T_SEA);
  fill(tiles, 0, 0, COLS, 2, T_LAND);
  fill(tiles, 18, 2, 4, 5, T_BERTH);
  return { tiles, startX: 160, startY: (ROWS - 1) * TILE, berth: { x: 18, y: 2, w: 4, h: 5 } };
}

function tileAt(layout: HarborLayout, px: number, py: number): number {
  const tx = Math.floor(px / TILE);
  const ty = Math.floor(py / TILE);
  if (tx < 0 || tx >= COLS || ty < 0) return T_LAND;
  if (ty >= ROWS) return T_SEA; // open sea behind the entrance
  return layout.tiles[ty * COLS + tx];
}

export function hullPoints(s: HarborState): [number, number][] {
  const [dx, dy] = DIRS[s.heading];
  const cx = idiv(s.x, SUB);
  const cy = idiv(s.y, SUB);
  const ox = idiv(dx * HALF_LEN, 256);
  const oy = idiv(dy * HALF_LEN, 256);
  return [
    [cx + ox, cy + oy],
    [cx, cy],
    [cx - ox, cy - oy],
  ];
}

export function harborInit(layout: HarborLayout): HarborState {
  return {
    frame: 0,
    x: layout.startX * SUB,
    y: layout.startY * SUB,
    heading: 24,
    speed: 0,
    throttle: 0,
    turnAcc: 0,
    collisions: 0,
    cooldown: 0,
    prevKeys: 0,
    result: 'playing',
  };
}

export function harborStep(layout: HarborLayout, s: HarborState, keys: number): void {
  if (s.result !== 'playing') return;
  s.frame++;
  const pressed = keys & ~s.prevKeys;
  s.prevKeys = keys;
  if (pressed & KEY_UP) s.throttle = Math.min(3, s.throttle + 1);
  if (pressed & KEY_DOWN) s.throttle = Math.max(-1, s.throttle - 1);
  const target = THROTTLE_SPEED[s.throttle + 1];
  if (s.speed < target) s.speed++;
  else if (s.speed > target) s.speed--;
  const turn = (keys & KEY_LEFT ? -1 : 0) + (keys & KEY_RIGHT ? 1 : 0);
  if (turn && Math.abs(s.speed) >= 8) {
    s.turnAcc += Math.abs(s.speed);
    while (s.turnAcc >= TURN_COST) {
      s.turnAcc -= TURN_COST;
      s.heading = (s.heading + turn + 32) % 32;
    }
  } else s.turnAcc = 0;
  const [dx, dy] = DIRS[s.heading];
  const px = s.x;
  const py = s.y;
  s.x += idiv(dx * s.speed, 256);
  s.y += idiv(dy * s.speed, 256);
  if (s.cooldown > 0) s.cooldown--;
  const hit = hullPoints(s).some(([x, y]) => {
    const t = tileAt(layout, x, y);
    return t === T_LAND || t === T_ROCK || t === T_BOAT;
  });
  if (hit) {
    s.x = px;
    s.y = py;
    s.speed = -idiv(s.speed, 2);
    s.throttle = 0;
    if (s.cooldown === 0) {
      s.collisions++;
      s.cooldown = 20;
    }
  }
  // Leaving through the entrance counts as a bounce back.
  if (s.y > (ROWS + 2) * TILE * SUB) {
    s.y = py;
    s.speed = 0;
    s.throttle = 0;
  }
  const docked = Math.abs(s.speed) <= 16 && hullPoints(s).every(([x, y]) => tileAt(layout, x, y) === T_BERTH);
  if (docked) s.result = 'docked';
  else if (s.collisions >= HARBOR_MAX_COLLISIONS) s.result = 'crashed';
  else if (s.frame >= HARBOR_MAX_FRAMES) s.result = 'timeout';
}

export interface HarborOutcome {
  result: 'docked' | 'crashed' | 'timeout';
  collisions: number;
  frames: number;
}

/** Replays an input log (RLE encoded) and returns the authoritative outcome. */
export function simulateHarbor(seed: number, rle: number[]): HarborOutcome {
  const layout = harborLayout(seed);
  const s = harborInit(layout);
  const inputs = decodeInputs(rle, HARBOR_MAX_FRAMES);
  for (let i = 0; i < HARBOR_MAX_FRAMES && s.result === 'playing'; i++) harborStep(layout, s, inputs[i] ?? 0);
  return { result: s.result === 'playing' ? 'timeout' : s.result, collisions: s.collisions, frames: s.frame };
}
