import { describe, expect, it } from 'vitest';
import { allPortsReachable, findRoute, getPort, pointAlong } from './index.js';

describe('sea routing', () => {
  it('connects every pair of ports', () => {
    expect(allPortsReachable()).toEqual([]);
  });
  it('uses Suez unless the ship is too large', () => {
    const a = findRoute(getPort('rtm'), getPort('sin'));
    const b = findRoute(getPort('rtm'), getPort('sin'), { noSuez: true });
    expect(a.canals).toContain('suez');
    expect(b.canals).not.toContain('suez');
    expect(b.distance).toBeGreaterThan(a.distance);
    expect(a.distance).toBeGreaterThan(7500);
    expect(a.distance).toBeLessThan(9500);
  });
  it('uses Panama between the US coasts', () => {
    expect(findRoute(getPort('nyc'), getPort('lax')).canals).toContain('panama');
  });
  it('interpolates positions along the route', () => {
    const r = findRoute(getPort('yok'), getPort('lax'));
    const start = pointAlong(r, 0);
    const end = pointAlong(r, r.distance);
    expect(Math.abs(start.lon - 139.64)).toBeLessThan(0.01);
    expect(Math.abs(end.lon - -118.26)).toBeLessThan(0.01);
  });
});
