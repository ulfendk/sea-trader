import { describe, expect, it } from 'vitest';
import {
  COLS,
  DIRS,
  KEY_LEFT,
  KEY_RIGHT,
  KEY_UP,
  SUB,
  TILE,
  encodeInputs,
  harborInit,
  harborLayout,
  harborStep,
  reefInit,
  reefLayout,
  reefStep,
  simulateHarbor,
  simulateReef,
  T_BERTH,
} from './index.js';

describe('harbor mini-game', () => {
  it('times out with no input', () => {
    expect(simulateHarbor(1, []).result).toBe('timeout');
  });
  it('is deterministic', () => {
    const inputs = encodeInputs(
      Array.from({ length: 600 }, (_, i) => (i % 40 < 3 ? KEY_UP : i % 90 < 20 ? KEY_LEFT : 0)),
    );
    expect(simulateHarbor(99, inputs)).toEqual(simulateHarbor(99, inputs));
  });
  it('generates layouts with a berth', () => {
    for (let seed = 0; seed < 30; seed++) {
      const l = harborLayout(seed);
      expect(l.tiles.filter((t) => t === T_BERTH).length).toBeGreaterThan(0);
    }
  });
  it('can be won by a simple autopilot on most layouts', () => {
    let wins = 0;
    for (let seed = 0; seed < 20; seed++) {
      const layout = harborLayout(seed);
      const s = harborInit(layout);
      const frames: number[] = [];
      const path = bfsPath(layout);
      let wp = 0;
      while (s.result === 'playing' && frames.length < 2700) {
        const px = s.x / SUB;
        const py = s.y / SUB;
        while (wp < path.length - 1 && Math.hypot(path[wp][0] - px, path[wp][1] - py) < 10) wp++;
        const [tx, ty] = path[wp];
        const want = Math.round((Math.atan2(ty - py, tx - px) / (2 * Math.PI)) * 32 + 32) % 32;
        let diff = (want - s.heading + 32) % 32;
        if (diff > 16) diff -= 32;
        let keys = 0;
        if (diff < 0) keys |= KEY_LEFT;
        if (diff > 0) keys |= KEY_RIGHT;
        const near = wp === path.length - 1;
        const targetThrottle = near ? 1 : Math.abs(diff) > 3 ? 1 : 2;
        if (s.throttle < targetThrottle && !(s.prevKeys & KEY_UP)) keys |= KEY_UP;
        else if (s.throttle > targetThrottle && !(s.prevKeys & 2)) keys |= 2;
        frames.push(keys);
        harborStep(layout, s, keys);
      }
      const replay = simulateHarbor(seed, encodeInputs(frames));
      expect(replay.result).toBe(s.result === 'playing' ? 'timeout' : s.result);
      if (s.result === 'docked') wins++;
    }
    expect(wins).toBeGreaterThan(5);
    void DIRS;
  });
});

function bfsPath(layout: ReturnType<typeof harborLayout>): [number, number][] {
  const ROWS = layout.tiles.length / COLS;
  const ok = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const t = layout.tiles[(y + dy) * COLS + x + dx];
        if (y + dy < 0 || x + dx < 0 || x + dx >= COLS) return false;
        if (y + dy >= ROWS) continue;
        if (t !== 0 && t !== T_BERTH) return false;
      }
    return true;
  };
  const sx = Math.floor(layout.startX / TILE);
  const sy = ROWS - 2;
  const prev = new Map<number, number>();
  const q = [sy * COLS + sx];
  prev.set(q[0], -1);
  const b = layout.berth;
  const goal = (b.y + 2) * COLS + b.x + b.w / 2;
  while (q.length) {
    const c = q.shift()!;
    if (c === goal) break;
    const x = c % COLS;
    const y = Math.floor(c / COLS);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const n = (y + dy) * COLS + x + dx;
      if (prev.has(n) || y + dy < 0 || y + dy >= ROWS) continue;
      if (!ok(x + dx, y + dy) && n !== goal) continue;
      prev.set(n, c);
      q.push(n);
    }
  }
  const path: [number, number][] = [];
  for (let c = goal; c !== -1 && c !== undefined; c = prev.get(c)!)
    path.push([(c % COLS) * TILE + 4, Math.floor(c / COLS) * TILE + 4]);
  return path.reverse();
}

describe('reef mini-game', () => {
  it('is deterministic and wrecks with bad steering', () => {
    const inputs = encodeInputs(Array.from({ length: 1400 }, () => KEY_LEFT));
    const a = simulateReef(5, inputs);
    expect(a).toEqual(simulateReef(5, inputs));
    expect(a.result).toBe('wrecked');
  });
  it('can be cleared by following the channel', () => {
    const layout = reefLayout(12);
    const s = reefInit();
    const frames: number[] = [];
    while (s.result === 'playing' && frames.length < 5000) {
      const row = Math.min(219, Math.floor(s.scroll / SUB / TILE) + 2);
      let l = 0;
      let r = COLS;
      const cx = Math.floor(s.x / SUB / TILE);
      for (let c = cx; c >= 0; c--)
        if (layout.tiles[row * COLS + c]) {
          l = c;
          break;
        }
      for (let c = cx; c < COLS; c++)
        if (layout.tiles[row * COLS + c]) {
          r = c;
          break;
        }
      const mid = ((l + r) / 2) * TILE * SUB;
      const k = s.x < mid - 2 * SUB - s.vx * 6 ? KEY_RIGHT : s.x > mid + 2 * SUB - s.vx * 6 ? KEY_LEFT : 0;
      frames.push(k);
      reefStep(layout, s, k);
    }
    expect(simulateReef(12, encodeInputs(frames)).result).toBe(s.result);
    expect(s.result).toBe('cleared');
  });
});
