/** Small deterministic PRNG helpers (mulberry32 + string hashing). */

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hashParts(...parts: (string | number)[]): number {
  return hashString(parts.join('|'));
}

/** Advances a mulberry32 state and returns [nextState, value in [0,1)]. */
export function mulberry(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [s, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

/** Stateful RNG wrapper. `state` can be persisted and restored. */
export class Rng {
  constructor(public state: number) {}
  next(): number {
    const [s, v] = mulberry(this.state);
    this.state = s;
    return v;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    const total = items.reduce((a, t) => a + weight(t), 0);
    let r = this.next() * total;
    for (const t of items) {
      r -= weight(t);
      if (r <= 0) return t;
    }
    return items[items.length - 1];
  }
}

export function rngFor(...parts: (string | number)[]): Rng {
  return new Rng(hashParts(...parts));
}
