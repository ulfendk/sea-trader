import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  advance,
  applyCommand,
  createGame,
  offersAt,
  pendingActions,
  privateView,
  rankings,
  startGame,
  getShipClass,
  maxSpeed,
  type GameState,
  type Ship,
} from './index.js';

function setup(): { s: GameState; ship: Ship } {
  const s = createGame(42, { eventRate: 0, startingCash: 20_000_000 });
  addPlayer(s, 'u1', 'Alice');
  startGame(s);
  const r = applyCommand(s, 'u1', { type: 'buyShip', classId: 'handy', port: 'rtm', name: 'Sea Cow' });
  expect(r.result).toEqual({ ok: true });
  const ship = Object.values(s.ships)[0];
  return { s, ship };
}

describe('engine', () => {
  it('buys a ship and marks it awaiting orders', () => {
    const { s, ship } = setup();
    expect(ship.name).toBe('Sea Cow');
    expect(s.players.u1.cash).toBe(20_000_000 - 16_000_000);
    expect(pendingActions(s, 'u1')).toHaveLength(1);
  });

  it('runs a full charter voyage and gets paid', () => {
    const { s, ship } = setup();
    ship.port = 'syd';
    const offer = offersAt(s, 'syd').find((o) => o.type === 'bulk' && o.tons <= 28000)!;
    expect(offer).toBeTruthy();
    const speed = maxSpeed(ship);
    // Not enough fuel yet
    const fail = applyCommand(s, 'u1', { type: 'charter', shipId: ship.id, offerId: offer.offerId, speed });
    expect(fail.result.ok).toBe(false);
    const cls = getShipClass('handy');
    expect(applyCommand(s, 'u1', { type: 'refuel', shipId: ship.id, tons: cls.tank }).result.ok).toBe(true);
    const r = applyCommand(s, 'u1', { type: 'charter', shipId: ship.id, offerId: offer.offerId, speed });
    expect(r.result).toEqual({ ok: true });
    expect(ship.status).toBe('loading');
    // The offer is gone for others
    expect(offersAt(s, 'syd').some((o) => o.offerId === offer.offerId)).toBe(false);
    const cashBefore = s.players.u1.cash;
    let notices = advance(s, s.day + 200);
    // Ship should be waiting for pilot (deadline is 1 day so default tug applies)
    expect(notices.some((n) => n.action && /arrived off/.test(n.text))).toBe(true);
    expect(ship.status).toBe('in_port');
    expect(ship.port).toBe(offer.to);
    expect(s.players.u1.stats.revenue).toBeGreaterThan(0);
    expect(s.players.u1.stats.voyages).toBe(1);
    expect(s.players.u1.cash).not.toBe(cashBefore);
    notices = advance(s, s.day + 1);
    expect(privateView(s, 'u1')!.pending[0].kind).toBe('orders');
  });

  it('lets the player answer the pilot decision with tugs', () => {
    const { s, ship } = setup();
    applyCommand(s, 'u1', { type: 'refuel', shipId: ship.id, tons: 2000 });
    expect(applyCommand(s, 'u1', { type: 'sail', shipId: ship.id, to: 'lon', speed: 12 }).result.ok).toBe(
      true,
    );
    for (let i = 0; i < 400 && !ship.pending; i++) advance(s, s.day + 0.05);
    expect(ship.pending?.kind).toBe('pilot');
    expect(pendingActions(s, 'u1')[0].kind).toBe('pilot');
    const r = applyCommand(s, 'u1', { type: 'decide', shipId: ship.id, choice: 'tug' });
    expect(r.result.ok).toBe(true);
    advance(s, s.day + 1);
    expect(ship.status).toBe('in_port');
  });

  it('handles loans with limits', () => {
    const { s } = setup();
    expect(applyCommand(s, 'u1', { type: 'borrow', amount: 1e9 }).result.ok).toBe(false);
    expect(applyCommand(s, 'u1', { type: 'borrow', amount: 1_000_000 }).result.ok).toBe(true);
    expect(s.players.u1.loan).toBe(1_000_000);
    expect(applyCommand(s, 'u1', { type: 'repay', amount: 400_000 }).result.ok).toBe(true);
    expect(s.players.u1.loan).toBe(600_000);
  });

  it('charges daily costs and ranks players', () => {
    const { s } = setup();
    addPlayer(s, 'u2', 'Bob');
    const before = s.players.u1.cash;
    advance(s, s.day + 3);
    expect(s.players.u1.cash).toBeLessThan(before);
    const r = rankings(s);
    expect(r).toHaveLength(2);
    expect(r[0].netWorth).toBeGreaterThanOrEqual(r[1].netWorth);
  });

  it('is deterministic for a seed', () => {
    const run = () => {
      const s = createGame(7, { startingCash: 50_000_000 });
      addPlayer(s, 'u1', 'A');
      startGame(s);
      applyCommand(s, 'u1', { type: 'buyShip', classId: 'general', port: 'sin', name: 'X' });
      const ship = Object.values(s.ships)[0];
      applyCommand(s, 'u1', { type: 'refuel', shipId: ship.id, tons: 900 });
      applyCommand(s, 'u1', { type: 'sail', shipId: ship.id, to: 'rtm', speed: 14 });
      advance(s, 60);
      return JSON.stringify(s);
    };
    expect(run()).toEqual(run());
  });

  it('does not advance while paused', () => {
    const { s } = setup();
    s.status = 'paused';
    advance(s, 10);
    expect(s.day).toBe(0);
  });
});
