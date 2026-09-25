import { FREIGHT_BASE, getShipClass, type ShipClass } from '../data/ships.js';
import { getPort, type Port } from '../data/ports.js';
import type { CargoType, GameState, Market, PlayerState, Ship } from '../types.js';
import type { RouteOptions } from '../geo.js';

export const DAY_MS = 86_400_000;

export function gameDate(day: number, startYear: number): Date {
  return new Date(Date.UTC(startYear, 0, 1) + Math.floor(day * DAY_MS));
}

export function formatDate(day: number, startYear: number): string {
  const d = gameDate(day, startYear);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}k`;
  return `${sign}$${Math.round(a)}`;
}

export const routeOptsFor = (cls: ShipClass): RouteOptions => ({
  noSuez: !!cls.noSuez,
  noPanama: !!cls.noPanama,
});

export function shipAgeYears(ship: Pick<Ship, 'builtDay'>, day: number): number {
  return Math.max(0, (day - ship.builtDay) / 365);
}

export function shipValueFor(
  classId: string,
  builtDay: number,
  condition: number,
  market: Market,
  day: number,
): number {
  const cls = getShipClass(classId);
  const age = Math.max(0, (day - builtDay) / 365);
  const dep = Math.max(0.12, 1 - age * 0.045);
  return Math.round(cls.price * market.shipIndex * dep * (0.55 + 0.45 * (condition / 100)));
}

export function shipValue(ship: Ship, market: Market, day: number): number {
  return shipValueFor(ship.classId, ship.builtDay, ship.condition, market, day);
}

export function newShipPrice(classId: string, market: Market): number {
  return Math.round(getShipClass(classId).price * market.shipIndex);
}

export function fuelPrice(port: Port, market: Market): number {
  return Math.round(180 * market.fuelIndex * port.fuelFactor);
}

export function portFee(port: Port, cls: ShipClass): number {
  return Math.round(port.feeBase * Math.sqrt(cls.capacity / 10000));
}

export function tugFee(port: Port, cls: ShipClass): number {
  return Math.round(portFee(port, cls) * 0.35 + 2000);
}

/** Daily berth charge while a ship sits idle in port. */
export function berthFee(port: Port, cls: ShipClass): number {
  return Math.round(portFee(port, cls) * 0.05);
}

export function canalFee(canal: string, cls: ShipClass): number {
  return canal === 'suez' ? Math.round(20000 + cls.capacity * 1.2) : Math.round(18000 + cls.capacity * 1.4);
}

export function fuelPerDay(cls: ShipClass, speed: number): number {
  return cls.fuelPerDay * (speed / cls.speed) ** 3;
}

export function maxSpeed(ship: Ship): number {
  const cls = getShipClass(ship.classId);
  return Math.round(cls.speed * (0.8 + 0.2 * (ship.condition / 100)) * 10) / 10;
}

export function minSpeed(ship: Ship): number {
  return Math.round(getShipClass(ship.classId).speed * 0.5 * 10) / 10;
}

export function voyageDays(distance: number, speed: number): number {
  return distance / (speed * 24);
}

/** Fuel (t) needed for a voyage including a 10% reserve. */
export function fuelNeeded(cls: ShipClass, distance: number, speed: number): number {
  return Math.ceil(fuelPerDay(cls, speed) * voyageDays(distance, speed) * 1.1);
}

export function repairCostPerPoint(cls: ShipClass): number {
  return Math.round(cls.price * 0.001);
}

export const REPAIR_POINTS_PER_DAY = 8;

export function handlingRate(port: Port, type: CargoType): number {
  const mult: Record<CargoType, number> = { general: 0.6, container: 2, bulk: 1.2, oil: 2 };
  return port.handling * mult[type];
}

export function handlingDays(portId: string, type: CargoType, tons: number): number {
  return tons / handlingRate(getPort(portId), type);
}

export function freightRate(type: CargoType, distance: number, tons: number, market: Market): number {
  const base = FREIGHT_BASE[type];
  const sizeFactor = (10000 / Math.max(1000, tons)) ** 0.15;
  return (base.fixed + base.perNm * distance) * market.freight[type] * sizeFactor;
}

export function fleetValue(state: GameState, playerId: string): number {
  let v = 0;
  for (const s of Object.values(state.ships))
    if (s.owner === playerId) v += shipValue(s, state.market, state.day);
  return v;
}

export function netWorth(state: GameState, player: PlayerState): number {
  return Math.round(player.cash + fleetValue(state, player.id) - player.loan);
}

export function loanLimit(state: GameState, player: PlayerState): number {
  return Math.round(fleetValue(state, player.id) * 0.6 + 2_000_000);
}
