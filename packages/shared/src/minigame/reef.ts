import { Rng } from '../rng.js';
import { COLS, KEY_LEFT, KEY_RIGHT, SUB, TILE, decodeInputs } from './common.js';

/** Reef / ice passage mini-game: steer through a scrolling channel. */

export const REEF_ROWS = 220;
export const REEF_SCROLL = 384; // sub-pixels per frame (1.5 px)
export const REEF_MAX_FRAMES = Math.ceil((REEF_ROWS * TILE * SUB) / REEF_SCROLL) + 30;
export const REEF_MAX_HITS = 4;
export const REEF_SHIP_SCREEN_Y = 160;
const SHIP_W = 6;
const SHIP_H = 14;
const MAX_VX = 512;
const ACCEL = 40;

export interface ReefLayout {
  /** REEF_ROWS * COLS, 1 = reef. Row 0 is the start (bottom of the screen). */
  tiles: Uint8Array;
}

export interface ReefState {
  frame: number;
  x: number; // sub-pixel centre x
  scroll: number; // sub-pixels travelled
  vx: number;
  hits: number;
  cooldown: number;
  result: 'playing' | 'cleared' | 'wrecked';
}

export function reefLayout(seed: number): ReefLayout {
  const rng = new Rng(seed);
  const tiles = new Uint8Array(REEF_ROWS * COLS);
  let centre = COLS / 2;
  for (let r = 0; r < REEF_ROWS; r++) {
    const progress = r / REEF_ROWS;
    const width = r < 12 ? 20 : Math.max(7, Math.round(16 - progress * 9 + rng.range(-1, 1)));
    if (r >= 12)
      centre = Math.max(width / 2 + 2, Math.min(COLS - width / 2 - 2, centre + rng.range(-1.2, 1.2)));
    const left = Math.round(centre - width / 2);
    const right = left + width;
    for (let c = 0; c < COLS; c++) tiles[r * COLS + c] = c < left || c >= right ? 1 : 0;
    // occasional coral heads inside the channel
    if (r > 20 && r % 9 === 0 && rng.chance(0.6)) {
      const c = rng.int(left + 2, right - 3);
      tiles[r * COLS + c] = 1;
    }
  }
  return { tiles };
}

export function reefInit(): ReefState {
  return { frame: 0, x: (COLS * TILE * SUB) / 2, scroll: 0, vx: 0, hits: 0, cooldown: 0, result: 'playing' };
}

/** World row (from start) at a given world y in pixels (0 = start line, increasing forward). */
function reefTile(layout: ReefLayout, px: number, worldY: number): number {
  const c = Math.floor(px / TILE);
  const r = Math.floor(worldY / TILE);
  if (c < 0 || c >= COLS) return 1;
  if (r < 0 || r >= REEF_ROWS) return 0;
  return layout.tiles[r * COLS + c];
}

export function reefStep(layout: ReefLayout, s: ReefState, keys: number): void {
  if (s.result !== 'playing') return;
  s.frame++;
  const dir = (keys & KEY_LEFT ? -1 : 0) + (keys & KEY_RIGHT ? 1 : 0);
  if (dir) s.vx = Math.max(-MAX_VX, Math.min(MAX_VX, s.vx + dir * ACCEL));
  else s.vx = s.vx > 0 ? Math.max(0, s.vx - ACCEL / 2) : Math.min(0, s.vx + ACCEL / 2);
  s.x += s.vx;
  s.scroll += REEF_SCROLL;
  if (s.cooldown > 0) s.cooldown--;
  const cx = Math.floor(s.x / SUB);
  const wy = Math.floor(s.scroll / SUB);
  const corners: [number, number][] = [
    [cx - SHIP_W / 2, wy + SHIP_H / 2],
    [cx + SHIP_W / 2, wy + SHIP_H / 2],
    [cx - SHIP_W / 2, wy - SHIP_H / 2],
    [cx + SHIP_W / 2, wy - SHIP_H / 2],
  ];
  if (corners.some(([x, y]) => reefTile(layout, x, y))) {
    if (s.cooldown === 0) {
      s.hits++;
      s.cooldown = 30;
    }
    s.vx = -s.vx;
    // nudge back towards the centre of the screen to avoid getting stuck
    s.x += s.x < (COLS * TILE * SUB) / 2 ? SUB * 2 : -SUB * 2;
  }
  if (s.hits >= REEF_MAX_HITS) s.result = 'wrecked';
  else if (wy >= REEF_ROWS * TILE) s.result = 'cleared';
}

export interface ReefOutcome {
  result: 'cleared' | 'wrecked';
  hits: number;
}

export function simulateReef(seed: number, rle: number[]): ReefOutcome {
  const layout = reefLayout(seed);
  const s = reefInit();
  const inputs = decodeInputs(rle, REEF_MAX_FRAMES);
  for (let i = 0; i < REEF_MAX_FRAMES && s.result === 'playing'; i++) reefStep(layout, s, inputs[i] ?? 0);
  return { result: s.result === 'cleared' ? 'cleared' : 'wrecked', hits: s.hits };
}
