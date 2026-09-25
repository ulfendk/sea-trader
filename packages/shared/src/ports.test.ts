import { describe, expect, it } from 'vitest';
import { PORTS, portRegion, portsByRegion } from './index.js';

describe('ports', () => {
  it('have unique ids and a region each', () => {
    expect(new Set(PORTS.map((p) => p.id)).size).toBe(PORTS.length);
    for (const p of PORTS) expect(portRegion(p.id), p.id).toBeTruthy();
    expect(portsByRegion().reduce((n, [, list]) => n + list.length, 0)).toBe(PORTS.length);
  });
});
