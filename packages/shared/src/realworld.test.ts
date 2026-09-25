import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  advance,
  applyBrent,
  applyCommand,
  applyStorms,
  brentFuelIndex,
  createGame,
  findRoute,
  getPort,
  pointAlong,
  startGame,
  BASE_BRENT,
  type Storm,
} from './index.js';

function voyage(realWeather = true) {
  const s = createGame(
    3,
    { eventRate: 0, startingCash: 50_000_000, realWeather, actionDeadlineHours: 1000 },
    0,
  );
  addPlayer(s, 'u', 'A');
  startGame(s, 0);
  applyCommand(s, 'u', { type: 'buyShip', classId: 'general', port: 'rtm', name: 'Gale' });
  const ship = Object.values(s.ships)[0];
  applyCommand(s, 'u', { type: 'refuel', shipId: ship.id, tons: 900 });
  // A storm sitting on the Rotterdam–New York route, about halfway.
  const route = findRoute(getPort('rtm'), getPort('nyc'));
  const mid = pointAlong(route, route.distance / 2);
  const storm: Storm = {
    id: 'tc-1',
    name: 'Hurricane Test',
    lon: mid.lon,
    lat: mid.lat,
    radiusNm: 150,
    severity: 'red',
    windKmh: 220,
  };
  applyStorms(s, [storm]);
  expect(applyCommand(s, 'u', { type: 'sail', shipId: ship.id, to: 'nyc', speed: 15 }).result.ok).toBe(true);
  return { s, ship, route };
}

describe('real storms', () => {
  it('stops a ship at a storm and asks for a decision', () => {
    const { s, ship, route } = voyage();
    advance(s, 20);
    expect(ship.pending?.kind).toBe('weather');
    expect(ship.pending?.stormName).toBe('Hurricane Test');
    // Stopped at the storm's edge, not past it.
    expect(ship.voyage!.progressNm).toBeLessThan(route.distance / 2);
    expect(ship.voyage!.progressNm).toBeGreaterThan(route.distance / 2 - 200);
  });

  it('going around costs days but no damage, and the storm is faced once', () => {
    const { s, ship } = voyage();
    advance(s, 20);
    const cond = ship.condition;
    expect(applyCommand(s, 'u', { type: 'decide', shipId: ship.id, choice: 'around' }).result.ok).toBe(true);
    expect(ship.voyage!.holdUntil).toBeGreaterThan(s.day + 1.9);
    expect(ship.condition).toBe(cond);
    advance(s, s.day + 30);
    expect(ship.pending?.kind).toBe('pilot');
  });

  it('sailing through damages the ship', () => {
    const { s, ship } = voyage();
    advance(s, 20);
    const cond = ship.condition;
    applyCommand(s, 'u', { type: 'decide', shipId: ship.id, choice: 'through' });
    expect(ship.condition).toBeLessThanOrEqual(cond - 8);
  });

  it('ignores storms when real weather is off', () => {
    const { s, ship } = voyage(false);
    advance(s, 20);
    expect(ship.pending?.kind).not.toBe('weather');
  });
});

describe('real fuel prices', () => {
  it('sets the fuel index from Brent and keeps it there daily', () => {
    const s = createGame(4, { realFuel: true }, 0);
    startGame(s, 0);
    applyBrent(s, 90, '2026-09-24');
    expect(s.market.fuelIndex).toBeCloseTo(90 / BASE_BRENT);
    advance(s, 5);
    expect(s.market.fuelIndex).toBeCloseTo(90 / BASE_BRENT);
    expect(s.market.brentDate).toBe('2026-09-24');
  });

  it('keeps simulated prices when real fuel is off', () => {
    const s = createGame(4, { realFuel: false }, 0);
    startGame(s, 0);
    applyBrent(s, 150, '2026-09-24');
    expect(s.market.fuelIndex).toBe(1);
  });

  it('clamps extreme prices', () => {
    expect(brentFuelIndex(1000)).toBe(3);
    expect(brentFuelIndex(5)).toBe(0.4);
  });
});
