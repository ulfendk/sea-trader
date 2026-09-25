import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  advance,
  applyBrent,
  applyCommand,
  applyConflicts,
  applyStorms,
  brentFuelIndex,
  createGame,
  findRoute,
  getPort,
  pointAlong,
  startGame,
  BASE_BRENT,
  DEFAULT_CONFLICT_ZONES,
  type ConflictZone,
  type GameState,
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

const topicNews = (s: GameState, topic: string) =>
  s.log.filter((l) => l.player === null && l.topic === topic);

describe('news from the real world', () => {
  const storm: Storm = {
    id: 'tc-9',
    name: 'Cyclone Erin',
    lon: -38,
    lat: 46.5,
    radiusNm: 200,
    severity: 'orange',
    windKmh: 150,
  };

  it('reports new, strengthening and passing storms once each', () => {
    const s = createGame(5, {}, 0);
    startGame(s, 0);
    applyStorms(s, [storm]);
    applyStorms(s, [storm]);
    expect(topicNews(s, 'weather').map((l) => l.text)).toEqual([
      expect.stringMatching(/^Cyclone Erin \(orange alert, winds 150 km\/h\) is raging \d+ nm \S+ of /),
    ]);
    applyStorms(s, [{ ...storm, severity: 'red' }]);
    applyStorms(s, []);
    const texts = topicNews(s, 'weather').map((l) => l.text);
    expect(texts[1]).toMatch(/strengthened to a red alert/);
    expect(texts[2]).toMatch(/blown itself out/);
  });

  it('keeps storms out of the news when real weather is off', () => {
    const s = createGame(5, { realWeather: false }, 0);
    applyStorms(s, [storm]);
    expect(topicNews(s, 'weather')).toHaveLength(0);
    expect(s.storms).toEqual([]);
  });

  it('reports only notable Brent moves', () => {
    const s = createGame(6, { realFuel: true }, 0);
    startGame(s, 0);
    applyBrent(s, 80, 'd1');
    applyBrent(s, 82, 'd2');
    applyBrent(s, 85, 'd3');
    applyBrent(s, 79, 'd4');
    const texts = topicNews(s, 'fuel').map((l) => l.text);
    expect(texts).toHaveLength(3);
    expect(texts[0]).toMatch(/now follow Brent crude, trading at \$80\.00/);
    expect(texts[1]).toMatch(/Brent crude up 6\.3% to \$85\.00\/bbl: bunker prices rise/);
    expect(texts[2]).toMatch(/Brent crude down 7\.1% to \$79\.00/);
  });
});

describe('conflict zones', () => {
  function toBombay(realConflicts = true) {
    const s = createGame(
      7,
      { eventRate: 0, startingCash: 50_000_000, realConflicts, actionDeadlineHours: 1000 },
      0,
    );
    addPlayer(s, 'u', 'A');
    startGame(s, 0);
    applyConflicts(s, DEFAULT_CONFLICT_ZONES);
    applyCommand(s, 'u', { type: 'buyShip', classId: 'general', port: 'rtm', name: 'Dove' });
    const ship = Object.values(s.ships)[0];
    applyCommand(s, 'u', { type: 'refuel', shipId: ship.id, tons: 2000 });
    expect(applyCommand(s, 'u', { type: 'sail', shipId: ship.id, to: 'bom', speed: 15 }).result.ok).toBe(
      true,
    );
    return { s, ship, cash: () => s.players.u.cash };
  }

  it('announces zones and stops ships at the Red Sea', () => {
    const { s, ship } = toBombay();
    expect(topicNews(s, 'conflict')).toHaveLength(DEFAULT_CONFLICT_ZONES.length);
    advance(s, 40);
    expect(ship.pending?.kind).toBe('conflict');
    expect(ship.pending?.zoneId).toBe('red-sea');
    expect(ship.pending?.premium).toBeGreaterThan(0);
  });

  it('avoiding costs days, not money, and the zone is faced once', () => {
    const { s, ship, cash } = toBombay();
    advance(s, 40);
    const before = cash();
    applyCommand(s, 'u', { type: 'decide', shipId: ship.id, choice: 'avoid' });
    expect(cash()).toBe(before);
    expect(ship.voyage!.holdUntil).toBeGreaterThan(s.day + 9.9);
    advance(s, s.day + 12);
    expect(ship.pending?.zoneId).not.toBe('red-sea');
  });

  it('sailing through pays the war-risk premium', () => {
    const { s, ship, cash } = toBombay();
    advance(s, 40);
    const before = cash();
    const premium = ship.pending!.premium!;
    applyCommand(s, 'u', { type: 'decide', shipId: ship.id, choice: 'through' });
    expect(cash()).toBe(before - premium);
  });

  it('reports escalation and lifted zones', () => {
    const s = createGame(8, {}, 0);
    startGame(s, 0);
    const zone: ConflictZone = { ...DEFAULT_CONFLICT_ZONES[4] };
    applyConflicts(s, [zone]);
    applyConflicts(s, [{ ...zone, level: 'war' }]);
    applyConflicts(s, []);
    const texts = topicNews(s, 'conflict').map((l) => l.text);
    expect(texts[0]).toMatch(/^The Somali Basin is now an elevated-risk area: /);
    expect(texts[1]).toBe('The Somali Basin escalates: now a war zone.');
    expect(texts[2]).toBe('The Somali Basin is no longer considered a conflict zone.');
  });

  it('ignores zones when the game has them switched off', () => {
    const { s, ship } = toBombay(false);
    advance(s, 40);
    expect(ship.pending?.kind).not.toBe('conflict');
    expect(topicNews(s, 'conflict')).toHaveLength(0);
  });
});
