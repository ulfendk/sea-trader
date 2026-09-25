import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  advance,
  createGame,
  formatGameTime,
  gameTime,
  migrateGameState,
  getPort,
  portLocalTime,
  PORTS,
  startGame,
  startTsOf,
  subsolarPoint,
  DAY_MS,
} from './index.js';

describe('game time', () => {
  it('starts a new game at the real current time', () => {
    const created = Date.UTC(2026, 8, 25, 7, 0);
    const started = Date.UTC(2026, 8, 25, 9, 30);
    const s = createGame(1, {}, created);
    expect(s.startTs).toBe(created);
    addPlayer(s, 'u', 'A');
    startGame(s, started);
    expect(s.startTs).toBe(started);
    advance(s, 1.5);
    expect(gameTime(s.startTs, s.day)).toBe(started + 1.5 * DAY_MS);
  });

  it('keeps the start time when a paused game resumes', () => {
    const s = createGame(1, {}, 1000);
    startGame(s, 2000);
    advance(s, 0.5);
    s.status = 'paused';
    startGame(s, 999_999);
    expect(s.startTs).toBe(2000);
  });

  it('migrates old saves so the current game moment is the real time', () => {
    const clockTs = Date.UTC(2026, 8, 25, 8, 0);
    const s = createGame(1, {}, 0) as ReturnType<typeof createGame> & { startTs?: number };
    s.status = 'running';
    s.day = 42.5;
    delete s.startTs;
    s.settings.startYear = 1990;
    expect(migrateGameState(s, clockTs)).toBe(true);
    expect(gameTime(s.startTs!, s.day)).toBe(clockTs);
    expect(s.settings.startYear).toBeUndefined();
    // Idempotent
    expect(migrateGameState(s, clockTs + 1000)).toBe(false);
    // An old game that never started begins when it is started.
    const lobby = createGame(2, {}, 0) as ReturnType<typeof createGame> & { startTs?: number };
    delete lobby.startTs;
    migrateGameState(lobby, clockTs);
    expect(lobby.startTs).toBe(clockTs);
  });

  it('reads old saves that only had a start year', () => {
    expect(
      startTsOf({ startTs: undefined as unknown as number, settings: { startYear: 1990 } as never }),
    ).toBe(Date.UTC(1990, 0, 1));
  });

  it('formats in a given time zone', () => {
    const ts = Date.UTC(2026, 8, 25, 23, 30);
    expect(formatGameTime(ts, 0, { time: true, timeZone: 'UTC' })).toMatch(/^25 Sept? 2026,? 23:30$/);
    expect(formatGameTime(ts, 0, { timeZone: 'Asia/Tokyo' })).toContain('26');
    expect(portLocalTime(getPort('nyc').tz, ts)).toBe('19:30');
    expect(portLocalTime(getPort('yok').tz, ts)).toBe('08:30');
  });

  it('every port has a valid time zone', () => {
    for (const p of PORTS) expect(() => portLocalTime(p.tz, 0)).not.toThrow();
  });

  it('puts the sun in the right place', () => {
    const june = subsolarPoint(Date.UTC(2026, 5, 21, 12, 0));
    expect(june.lat).toBeCloseTo(23.4, 0);
    expect(Math.abs(june.lon)).toBeLessThan(2);
    const march = subsolarPoint(Date.UTC(2026, 2, 20, 0, 0));
    expect(Math.abs(march.lat)).toBeLessThan(1);
    expect(180 - Math.abs(march.lon)).toBeLessThan(4);
    const dec = subsolarPoint(Date.UTC(2026, 11, 21, 18, 0));
    expect(dec.lat).toBeCloseTo(-23.4, 0);
    expect(dec.lon).toBeGreaterThan(-93);
    expect(dec.lon).toBeLessThan(-87);
  });
});
