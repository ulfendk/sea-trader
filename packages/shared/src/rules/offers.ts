import { PORTS, getPort } from '../data/ports.js';
import { SHIP_CLASSES } from '../data/ships.js';
import { findRoute } from '../geo.js';
import { hashParts, Rng } from '../rng.js';
import type { CharterOffer, GameState } from '../types.js';
import { freightRate, handlingDays } from './economy.js';

export const OFFER_PERIOD_DAYS = 3;

/** Charter offers currently available in a port. Deterministic per game seed, port and period. */
export function offersAt(state: GameState, portId: string): CharterOffer[] {
  const from = getPort(portId);
  const period = Math.floor(state.day / OFFER_PERIOD_DAYS);
  const rng = new Rng(hashParts(state.seed, 'offers', portId, period));
  const offers: CharterOffer[] = [];
  // For every ship class: a chance of cargo sized for it, driven by what the port exports.
  const slots: { cls: (typeof SHIP_CLASSES)[number] }[] = [];
  for (const cls of SHIP_CLASSES) {
    const supply = from.exports[cls.cargo];
    const p = Math.min(0.95, 0.2 + supply * 0.17);
    if (rng.chance(p)) slots.push({ cls });
    if (rng.chance(p * 0.6)) slots.push({ cls });
    if (supply >= 4 && rng.chance(p * 0.4)) slots.push({ cls });
  }
  slots.forEach(({ cls }, i) => {
    const type = cls.cargo;
    const dests = PORTS.filter((p) => p.id !== portId);
    const to = rng.weighted(dests, (p) => p.imports[type] + 0.2);
    const tons = Math.max(500, Math.round((cls.capacity * rng.range(0.55, 1)) / 100) * 100);
    const distance = findRoute(from, to).distance;
    const demand = 0.85 + to.imports[type] * 0.06;
    const rate = freightRate(type, distance, tons, state.market) * demand * rng.range(0.85, 1.2);
    const pay = Math.round((rate * tons) / 100) * 100;
    const travel = distance / (cls.speed * 0.9 * 24);
    const handling = handlingDays(portId, type, tons) + handlingDays(to.id, type, tons);
    const dueDay = Math.ceil(state.day + travel + handling + rng.range(4, 14));
    const id = `${portId}-${period}-${i}`;
    if (state.takenOffers[id] !== undefined) return;
    offers.push({
      offerId: id,
      type,
      tons,
      from: portId,
      to: to.id,
      pay,
      rate: Math.round(rate * 100) / 100,
      dueDay,
      penaltyPerDay: Math.round(pay * 0.02),
      expiresDay: (period + 1) * OFFER_PERIOD_DAYS,
    });
  });
  return offers;
}
