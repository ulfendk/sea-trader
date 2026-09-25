import { HAZARD_ZONES, PIRATE_ZONES, PORTS, getPort } from '../data/ports.js';
import { SHIP_CLASSES, getShipClass, SHIP_CLASSES_BY_ID } from '../data/ships.js';
import { findRoute, haversineNm, pointAlong, type Route } from '../geo.js';
import { simulateHarbor } from '../minigame/harbor.js';
import { simulateReef } from '../minigame/reef.js';
import { hashParts, Rng } from '../rng.js';
import {
  DEFAULT_SETTINGS,
  type Command,
  type CommandResult,
  type ConflictLevel,
  type ConflictZone,
  type GameSettings,
  type GameState,
  type LogEntry,
  type NewsTopic,
  type Notice,
  type PendingDecision,
  type PlayerState,
  type Ship,
  type Storm,
  type UsedShipListing,
  type VoyageEvent,
} from '../types.js';
import {
  berthFee,
  DAY_MS,
  canalFee,
  fleetValue,
  formatMoney,
  fuelNeeded,
  fuelPerDay,
  fuelPrice,
  handlingDays,
  loanLimit,
  maxSpeed,
  minSpeed,
  netWorth,
  newShipPrice,
  portFee,
  REPAIR_POINTS_PER_DAY,
  repairCostPerPoint,
  routeOptsFor,
  shipAgeYears,
  shipValue,
  shipValueFor,
  tugFee,
  voyageDays,
} from './economy.js';
import { offersAt } from './offers.js';

export const PLAYER_COLORS = [0xe04040, 0x40a0ff, 0xf0c020, 0x40d060, 0xc060ff, 0xff8020, 0x20d0d0, 0xf070b0];
const STEP = 0.02;
const LOG_MAX = 400;

class StateRng extends Rng {
  constructor(private game: GameState) {
    super(game.rng);
  }
  next(): number {
    const v = super.next();
    this.game.rng = this.state;
    return v;
  }
}

/** Mutable context for one engine operation: collects notices for the server. */
export class Ctx {
  notices: Notice[] = [];
  constructor(public state: GameState) {}
  /** RNG whose state is persisted in the game state after every draw. */
  get rng(): Rng {
    return new StateRng(this.state);
  }
  log(entry: Omit<LogEntry, 'day'>, notify = false, action = false) {
    pushLog(this.state, entry);
    if (entry.player && (notify || action))
      this.notices.push({ player: entry.player, ship: entry.ship, text: entry.text, action });
  }
}

function pushLog(s: GameState, entry: Omit<LogEntry, 'day'>) {
  s.log.push({ day: Math.round(s.day * 100) / 100, ...entry });
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
}

/** Public news item, seen by every player in the game. */
function news(s: GameState, text: string, kind: LogEntry['kind'], topic: NewsTopic) {
  if (s.status === 'finished') return;
  pushLog(s, { player: null, text: text.charAt(0).toUpperCase() + text.slice(1), kind, topic });
}

export function createGame(seed: number, settings: Partial<GameSettings> = {}, now = Date.now()): GameState {
  const state: GameState = {
    version: 1,
    seed,
    rng: hashParts(seed, 'rng'),
    startTs: now,
    day: 0,
    status: 'lobby',
    settings: { ...DEFAULT_SETTINGS, ...settings },
    players: {},
    ships: {},
    market: { fuelIndex: 1, shipIndex: 1, freight: { general: 1, container: 1, bulk: 1, oil: 1 } },
    usedShips: [],
    takenOffers: {},
    lastDailyDay: 0,
    nextId: 1,
    log: [],
  };
  refreshUsedMarket(new Ctx(state));
  return state;
}

export function addPlayer(state: GameState, id: string, name: string, company?: string): PlayerState {
  const existing = state.players[id];
  if (existing) return existing;
  const used = new Set(Object.values(state.players).map((p) => p.color));
  const color =
    PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[Object.keys(state.players).length % 8];
  const player: PlayerState = {
    id,
    name,
    company: company || `${name} Shipping`,
    color,
    cash: state.settings.startingCash,
    loan: 0,
    joinedDay: state.day,
    bankrupt: false,
    stats: { revenue: 0, voyages: 0, expenses: 0 },
  };
  state.players[id] = player;
  new Ctx(state).log({
    player: null,
    text: `${player.company} has entered the shipping business.`,
    topic: 'company',
    kind: 'info',
  });
  return player;
}

function nextId(state: GameState, prefix: string): string {
  return `${prefix}${state.nextId++}`;
}

function spend(ctx: Ctx, player: PlayerState, amount: number) {
  player.cash -= amount;
  player.stats.expenses += amount;
}

function deadline(state: GameState): number {
  return state.day + state.settings.actionDeadlineHours / 24;
}

export function shipRoute(ship: Ship): Route | null {
  if (!ship.voyage) return null;
  const cls = getShipClass(ship.classId);
  return findRoute(getPort(ship.voyage.from), getPort(ship.voyage.to), routeOptsFor(cls));
}

// ---------------------------------------------------------------- used market

function refreshUsedMarket(ctx: Ctx) {
  const s = ctx.state;
  const rng = ctx.rng;
  const listings: UsedShipListing[] = [];
  const n = rng.int(5, 8);
  for (let i = 0; i < n; i++) {
    const cls = rng.weighted(SHIP_CLASSES, (c) => 1 / Math.sqrt(c.price / 3e6));
    const ageYears = rng.range(3, 22);
    const builtDay = Math.round(s.day - ageYears * 365);
    const condition = Math.round(rng.range(45, 92));
    const price =
      Math.round(
        (shipValueFor(cls.id, builtDay, condition, s.market, s.day) * rng.range(0.85, 1.05)) / 1000,
      ) * 1000;
    listings.push({
      id: nextId(s, 'u'),
      classId: cls.id,
      builtDay,
      condition,
      port: rng.pick(PORTS).id,
      price,
    });
  }
  s.usedShips = listings;
}

// ---------------------------------------------------------------- voyages

function scheduleEvents(ctx: Ctx, ship: Ship, route: Route, speed: number): VoyageEvent[] {
  const s = ctx.state;
  const rng = ctx.rng;
  const rate = s.settings.eventRate;
  const events: VoyageEvent[] = [];
  const d = route.distance;
  const at = () => Math.round(rng.range(0.08, 0.92) * d);
  const seed = () => Math.floor(rng.next() * 2 ** 31);
  // With real weather on, most storms come from the live feed instead.
  const storms = (d / 10000) * rate * (s.settings.realWeather ? 0.3 : 1);
  for (let k = 0; k < 3; k++)
    if (rng.chance(Math.min(0.6, storms / (k + 1)))) events.push({ kind: 'storm', atNm: at(), seed: seed() });
  if (rng.chance((0.04 + (100 - ship.condition) / 250) * rate))
    events.push({ kind: 'engine', atNm: at(), seed: seed() });
  if (rng.chance(0.015 * rate)) events.push({ kind: 'fire', atNm: at(), seed: seed() });
  if (rng.chance(Math.min(0.5, (0.05 * d) / 5000) * rate))
    events.push({ kind: 'distress', atNm: at(), seed: seed() });
  // Zone-based: walk the route.
  let pirates = false;
  let hazard = false;
  const stepNm = 200;
  const hoursPerStep = stepNm / speed;
  for (let nm = stepNm; nm < d - stepNm; nm += stepNm) {
    const p = pointAlong(route, nm);
    if (!pirates)
      for (const [x0, x1, y0, y1, risk] of PIRATE_ZONES)
        if (
          p.lon >= x0 &&
          p.lon <= x1 &&
          p.lat >= y0 &&
          p.lat <= y1 &&
          rng.chance(risk * (hoursPerStep / 24) * rate * 3)
        ) {
          events.push({ kind: 'pirates', atNm: nm, seed: seed() });
          pirates = true;
        }
    if (!hazard)
      for (const [x0, x1, y0, y1, risk, place] of HAZARD_ZONES)
        if (p.lon >= x0 && p.lon <= x1 && p.lat >= y0 && p.lat <= y1 && rng.chance(risk * rate * 2)) {
          events.push({ kind: 'hazard', atNm: nm, seed: seed(), place });
          hazard = true;
        }
  }
  return events.sort((a, b) => a.atNm - b.atNm);
}

function depart(ctx: Ctx, ship: Ship, to: string, speed: number) {
  const s = ctx.state;
  const cls = getShipClass(ship.classId);
  const player = s.players[ship.owner];
  const route = findRoute(getPort(ship.port), getPort(to), routeOptsFor(cls));
  for (const canal of route.canals) {
    const fee = canalFee(canal, cls);
    spend(ctx, player, fee);
    ctx.log({
      player: ship.owner,
      ship: ship.id,
      text: `${ship.name} paid ${formatMoney(fee)} ${canal === 'suez' ? 'Suez' : 'Panama'} canal dues.`,
      kind: 'info',
    });
  }
  ship.voyage = {
    from: ship.port,
    to,
    departDay: s.day,
    distance: route.distance,
    speed,
    progressNm: 0,
    delayDays: 0,
    holdUntil: 0,
    events: scheduleEvents(ctx, ship, route, speed),
    canals: route.canals,
  };
  ship.status = 'at_sea';
  ship.port = to;
  ship.plannedSpeed = undefined;
  ship.idleSince = undefined;
  ctx.log({
    player: ship.owner,
    ship: ship.id,
    text: `${ship.name} sailed from ${getPort(ship.voyage.from).name} for ${getPort(to).name} (${route.distance} nm, ~${Math.ceil(voyageDays(route.distance, speed))} days).`,
    kind: 'info',
  });
}

function hold(ship: Ship, day: number, days: number) {
  if (!ship.voyage) return;
  ship.voyage.holdUntil = Math.max(ship.voyage.holdUntil, day) + days;
  ship.voyage.delayDays += days;
}

function damage(ship: Ship, pts: number) {
  ship.condition = Math.max(1, Math.round((ship.condition - pts) * 10) / 10);
}

function fireEvent(ctx: Ctx, ship: Ship, ev: VoyageEvent) {
  const s = ctx.state;
  const rng = new Rng(ev.seed);
  const player = s.players[ship.owner];
  const cls = getShipClass(ship.classId);
  const log = (text: string, kind: LogEntry['kind'], notify = true) =>
    ctx.log({ player: ship.owner, ship: ship.id, text, kind }, notify);
  switch (ev.kind) {
    case 'storm': {
      const dmg = Math.round(rng.range(1, 4));
      const delay = Math.round(rng.range(0.3, 1.5) * 10) / 10;
      damage(ship, dmg);
      hold(ship, s.day, delay);
      log(`${ship.name} ran into a heavy storm: ${dmg}% damage, ${delay} days lost.`, 'bad');
      break;
    }
    case 'engine': {
      const delay = Math.round(rng.range(1, 3) * 10) / 10;
      const cost = Math.round(repairCostPerPoint(cls) * rng.range(2, 5));
      damage(ship, 2);
      hold(ship, s.day, delay);
      spend(ctx, player, cost);
      log(
        `${ship.name} suffered an engine breakdown. Repairs at sea cost ${formatMoney(cost)}, ${delay} days lost.`,
        'bad',
      );
      break;
    }
    case 'fire': {
      const dmg = Math.round(rng.range(5, 12));
      damage(ship, dmg);
      if (ship.cargo) ship.cargo.pay = Math.round(ship.cargo.pay * 0.8);
      hold(ship, s.day, 0.5);
      log(
        `Fire aboard ${ship.name}! ${dmg}% damage${ship.cargo ? ' and 20% of the cargo value lost' : ''}.`,
        'bad',
      );
      break;
    }
    case 'pirates': {
      const ransom =
        Math.round(((ship.cargo ? ship.cargo.pay * 0.15 : 0) + 40000 + cls.capacity * 1.5) / 1000) * 1000;
      raise(
        ctx,
        ship,
        { kind: 'pirates', ransom, seed: ev.seed },
        `Pirates are closing in on ${ship.name}! Pay ${formatMoney(ransom)} or try to outrun them?`,
      );
      break;
    }
    case 'hazard': {
      const detourDays = Math.round(rng.range(1, 3) * 10) / 10;
      raise(
        ctx,
        ship,
        { kind: 'hazard', detourDays, place: ev.place, seed: ev.seed },
        `${ship.name} is approaching ${ev.place}. Navigate through yourself or detour (+${detourDays} days)?`,
      );
      break;
    }
    case 'distress': {
      raise(
        ctx,
        ship,
        { kind: 'distress', seed: ev.seed },
        `${ship.name} picked up a distress call nearby. Divert to rescue (+1 day)?`,
      );
      break;
    }
  }
}

function raise(ctx: Ctx, ship: Ship, p: Omit<PendingDecision, 'sinceDay' | 'deadlineDay'>, text: string) {
  ship.pending = { ...p, sinceDay: ctx.state.day, deadlineDay: deadline(ctx.state) };
  ctx.log({ player: ship.owner, ship: ship.id, text, kind: 'action' }, true, true);
}

function arrive(ctx: Ctx, ship: Ship) {
  const s = ctx.state;
  const port = getPort(ship.port);
  const cls = getShipClass(ship.classId);
  ship.status = 'awaiting_pilot';
  raise(
    ctx,
    ship,
    {
      kind: 'pilot',
      tugFee: tugFee(port, cls),
      seed: hashParts(s.seed, ship.id, 'harbor', Math.floor(s.day)),
    },
    `${ship.name} has arrived off ${port.name}. Steer her in yourself or hire tugs (${formatMoney(tugFee(port, cls))})?`,
  );
}

function dock(ctx: Ctx, ship: Ship, viaTug: boolean) {
  const s = ctx.state;
  const port = getPort(ship.port);
  const cls = getShipClass(ship.classId);
  const player = s.players[ship.owner];
  const fee = portFee(port, cls);
  spend(ctx, player, fee);
  ship.pending = null;
  ship.status = 'docking';
  ship.statusUntil = s.day + (viaTug ? 0.25 : 0.1);
  ctx.log({
    player: ship.owner,
    ship: ship.id,
    text: `${ship.name} berthed in ${port.name}. Port dues ${formatMoney(fee)}.`,
    kind: 'info',
  });
}

function becomeIdle(ctx: Ctx, ship: Ship) {
  ship.status = 'in_port';
  ship.voyage = null;
  ship.idleSince = ctx.state.day;
  ctx.log(
    {
      player: ship.owner,
      ship: ship.id,
      text: `${ship.name} is in ${getPort(ship.port).name} awaiting orders.`,
      kind: 'action',
    },
    true,
    true,
  );
}

function finishDocking(ctx: Ctx, ship: Ship) {
  const s = ctx.state;
  const port = getPort(ship.port);
  if (ship.cargo && ship.cargo.to === ship.port) {
    let days = handlingDays(ship.port, ship.cargo.type, ship.cargo.tons);
    if (ctx.rng.chance(port.strikeRisk)) {
      const strike = Math.round(ctx.rng.range(1, 4));
      days += strike;
      ctx.log(
        {
          player: ship.owner,
          ship: ship.id,
          text: `Dock strike in ${port.name}! Unloading of ${ship.name} delayed ${strike} days.`,
          kind: 'bad',
        },
        true,
      );
    }
    ship.status = 'unloading';
    ship.statusUntil = s.day + days;
    ship.voyage = null;
  } else becomeIdle(ctx, ship);
}

function finishUnloading(ctx: Ctx, ship: Ship) {
  const s = ctx.state;
  const player = s.players[ship.owner];
  const cargo = ship.cargo!;
  const late = Math.max(0, Math.ceil(s.day - cargo.dueDay));
  const penalty = Math.min(Math.round(cargo.pay * 0.9), late * cargo.penaltyPerDay);
  const pay = cargo.pay - penalty;
  player.cash += pay;
  player.stats.revenue += pay;
  player.stats.voyages++;
  ship.cargo = null;
  ctx.log(
    {
      player: ship.owner,
      ship: ship.id,
      text: `${ship.name} delivered her cargo: ${formatMoney(pay)} received${late ? ` (${late} days late, ${formatMoney(penalty)} penalty)` : ''}.`,
      kind: late ? 'bad' : 'good',
    },
    true,
  );
  becomeIdle(ctx, ship);
}

// ---------------------------------------------------------------- decisions

function resolve(ctx: Ctx, ship: Ship, choice: string, inputs?: number[]): CommandResult {
  const s = ctx.state;
  const p = ship.pending;
  if (!p) return { ok: false, error: 'Nothing to decide' };
  const player = s.players[ship.owner];
  const cls = getShipClass(ship.classId);
  const log = (text: string, kind: LogEntry['kind']) =>
    ctx.log({ player: ship.owner, ship: ship.id, text, kind }, true);
  if (choice === 'playing') {
    // The player started a mini-game: guarantee at least 5 real minutes to finish it.
    if (p.kind !== 'pilot' && p.kind !== 'hazard') return { ok: false, error: 'Invalid choice' };
    p.deadlineDay = Math.max(p.deadlineDay, s.day + (s.settings.timeScale * 5) / 1440);
    return { ok: true };
  }
  switch (p.kind) {
    case 'pilot': {
      if (choice === 'steer') {
        if (!inputs) return { ok: false, error: 'Missing inputs' };
        const out = simulateHarbor(p.seed, inputs);
        const dmg = out.collisions * 2;
        if (dmg) damage(ship, dmg);
        if (out.result === 'docked') {
          log(
            `Fine seamanship! ${ship.name} docked without tugs${dmg ? ` (${dmg}% damage from bumps)` : ''}.`,
            'good',
          );
          dock(ctx, ship, false);
          return { ok: true, message: 'docked' };
        }
        spend(ctx, player, p.tugFee ?? 0);
        log(
          `${ship.name} ${out.result === 'crashed' ? 'ran aground' : 'could not make the berth'}; tugs were called (${formatMoney(p.tugFee ?? 0)}${dmg ? `, ${dmg}% damage` : ''}).`,
          'bad',
        );
        dock(ctx, ship, true);
        return { ok: true, message: out.result };
      }
      if (choice !== 'tug') return { ok: false, error: 'Invalid choice' };
      spend(ctx, player, p.tugFee ?? 0);
      dock(ctx, ship, true);
      return { ok: true };
    }
    case 'pirates': {
      const ransom = p.ransom ?? 0;
      if (choice === 'pay') {
        spend(ctx, player, ransom);
        log(`${ship.name} paid ${formatMoney(ransom)} to the pirates and continued.`, 'bad');
      } else if (choice === 'run') {
        const rng = new Rng(p.seed);
        const escape = 0.25 + ship.voyage!.speed / 40;
        if (rng.chance(escape)) log(`${ship.name} outran the pirates!`, 'good');
        else {
          const cost = Math.round(ransom * 1.5);
          spend(ctx, player, cost);
          damage(ship, 8);
          log(`The pirates boarded ${ship.name}: ${formatMoney(cost)} lost and 8% damage.`, 'bad');
        }
      } else return { ok: false, error: 'Invalid choice' };
      break;
    }
    case 'hazard': {
      if (choice === 'detour') {
        hold(ship, s.day, p.detourDays ?? 1);
        log(`${ship.name} detoured around ${p.place} (+${p.detourDays} days).`, 'info');
      } else if (choice === 'navigate') {
        if (!inputs) return { ok: false, error: 'Missing inputs' };
        const out = simulateReef(p.seed, inputs);
        const dmg = out.hits * 3 + (out.result === 'wrecked' ? 10 : 0);
        if (dmg) damage(ship, dmg);
        if (out.result === 'wrecked') {
          hold(ship, s.day, (p.detourDays ?? 1) * 1.5);
          log(`${ship.name} struck ${p.place}: ${dmg}% damage and delays.`, 'bad');
        } else
          log(
            `${ship.name} threaded through ${p.place}${dmg ? ` with ${dmg}% damage` : ' unscathed'}.`,
            dmg ? 'info' : 'good',
          );
      } else return { ok: false, error: 'Invalid choice' };
      break;
    }
    case 'distress': {
      if (choice === 'rescue') {
        const rng = new Rng(p.seed);
        const reward = Math.round(rng.range(40000, 250000) / 1000) * 1000;
        hold(ship, s.day, 1);
        player.cash += reward;
        log(
          `${ship.name} rescued the crew of a stricken vessel. Salvage reward: ${formatMoney(reward)}.`,
          'good',
        );
      } else if (choice === 'ignore') {
        log(`${ship.name} held her course.`, 'info');
      } else return { ok: false, error: 'Invalid choice' };
      break;
    }
    case 'weather': {
      const name = p.stormName ?? 'the storm';
      if (choice === 'through') {
        const rng = new Rng(p.seed);
        const red = p.severity === 'red';
        const dmg = Math.round(rng.range(red ? 8 : 4, red ? 18 : 10));
        const delay = Math.round(rng.range(red ? 1 : 0.5, red ? 2 : 1.5) * 10) / 10;
        damage(ship, dmg);
        hold(ship, s.day, delay);
        log(`${ship.name} fought her way through ${name}: ${dmg}% damage, ${delay} days lost.`, 'bad');
      } else if (choice === 'around') {
        hold(ship, s.day, p.detourDays ?? 1);
        log(`${ship.name} steered around ${name} (+${p.detourDays} days).`, 'info');
      } else return { ok: false, error: 'Invalid choice' };
      break;
    }
    case 'conflict': {
      const place = p.place ?? 'the conflict zone';
      const level = p.level ?? 'elevated';
      if (choice === 'through') {
        spend(ctx, player, p.premium ?? 0);
        const rng = new Rng(p.seed);
        if (rng.chance(CONFLICT_ATTACK[level])) {
          const dmg = Math.round(rng.range(10, level === 'war' ? 30 : 20));
          const delay = Math.round(rng.range(1, 2.5) * 10) / 10;
          damage(ship, dmg);
          hold(ship, s.day, delay);
          log(
            `${ship.name} came under attack in ${place}: ${dmg}% damage, ${delay} days lost (war-risk cover ${formatMoney(p.premium ?? 0)}).`,
            'bad',
          );
          ctx.log({
            player: null,
            text: `${player.company}'s ${ship.name} was attacked in ${place}.`,
            kind: 'bad',
            topic: 'conflict',
          });
        } else
          log(
            `${ship.name} passed through ${place} safely (war-risk cover ${formatMoney(p.premium ?? 0)}).`,
            'info',
          );
      } else if (choice === 'avoid') {
        hold(ship, s.day, p.detourDays ?? 1);
        log(`${ship.name} avoided ${place} (+${p.detourDays} days).`, 'info');
      } else return { ok: false, error: 'Invalid choice' };
      break;
    }
  }
  void cls;
  ship.pending = null;
  return { ok: true };
}

const DEFAULT_CHOICE: Record<PendingDecision['kind'], string> = {
  pilot: 'tug',
  pirates: 'pay',
  hazard: 'detour',
  distress: 'ignore',
  weather: 'around',
  conflict: 'avoid',
};

// ---------------------------------------------------------------- real-world feeds

/** Brent price (USD/bbl) at which bunker prices are at their base level (fuel index 1). */
export const BASE_BRENT = 75;

/** Brent move (fraction) since the last fuel news item that makes the news again. */
const BRENT_NEWS_MOVE = 0.05;

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Describes a sea position relative to the nearest port, e.g. "820 nm east of New York". */
export function describePlace(lon: number, lat: number): string {
  let best = PORTS[0];
  let bd = Infinity;
  for (const port of PORTS) {
    const d = haversineNm(port.lon, port.lat, lon, lat);
    if (d < bd) {
      bd = d;
      best = port;
    }
  }
  if (bd < 60) return `off ${best.name}`;
  const dLon = ((lon - best.lon + 540) % 360) - 180;
  const dLat = lat - best.lat;
  const deg = (Math.atan2(dLon * Math.cos(((lat + best.lat) / 2) * (Math.PI / 180)), dLat) * 180) / Math.PI;
  const dir = COMPASS[Math.round((deg + 360) / 45) % 8];
  return `${Math.round(bd / 10) * 10} nm ${dir} of ${best.name}`;
}

/** Replaces the game's list of real storms (from the weather feed) and reports changes as news. */
export function applyStorms(state: GameState, storms: Storm[]) {
  if (!state.settings.realWeather) {
    state.storms = [];
    return;
  }
  const prev = new Map((state.storms ?? []).map((st) => [st.id, st]));
  for (const st of storms) {
    const old = prev.get(st.id);
    const wind = st.windKmh ? `, winds ${Math.round(st.windKmh)} km/h` : '';
    if (!old)
      news(
        state,
        `${st.name} (${st.severity} alert${wind}) is raging ${describePlace(st.lon, st.lat)}. Ships should steer clear.`,
        'bad',
        'weather',
      );
    else if (old.severity !== st.severity)
      news(
        state,
        st.severity === 'red'
          ? `${st.name} has strengthened to a red alert${wind}, ${describePlace(st.lon, st.lat)}.`
          : `${st.name} has weakened to an orange alert, ${describePlace(st.lon, st.lat)}.`,
        st.severity === 'red' ? 'bad' : 'info',
        'weather',
      );
  }
  for (const old of prev.values())
    if (!storms.some((st) => st.id === old.id))
      news(state, `${old.name} has blown itself out; the danger has passed.`, 'good', 'weather');
  state.storms = storms.map((st) => ({ ...st }));
}

/** Records the latest real Brent price; the fuel index follows it. Notable moves make the news. */
export function applyBrent(state: GameState, usd: number, date: string) {
  if (!(usd > 0)) return;
  const m = state.market;
  m.brent = usd;
  m.brentDate = date;
  if (!state.settings.realFuel) return;
  m.fuelIndex = brentFuelIndex(usd);
  const last = m.brentNews;
  const price = `$${usd.toFixed(2)}/bbl`;
  if (!last) news(state, `Bunker prices now follow Brent crude, trading at ${price}.`, 'info', 'fuel');
  else if (Math.abs(usd / last - 1) >= BRENT_NEWS_MOVE) {
    const up = usd > last;
    const pct = Math.abs((usd / last - 1) * 100).toFixed(1);
    news(
      state,
      `Brent crude ${up ? 'up' : 'down'} ${pct}% to ${price}: bunker prices ${up ? 'rise' : 'fall'}.`,
      up ? 'bad' : 'good',
      'fuel',
    );
  } else return;
  m.brentNews = usd;
}

const LEVEL_RANK: Record<ConflictLevel, number> = { elevated: 1, high: 2, war: 3 };
export const CONFLICT_LEVEL_TEXT: Record<ConflictLevel, string> = {
  elevated: 'an elevated-risk area',
  high: 'a high-risk area',
  war: 'a war zone',
};
/** War-risk insurance premium as a fraction of the ship's value, per transit. */
export const CONFLICT_PREMIUM: Record<ConflictLevel, number> = { elevated: 0.001, high: 0.0035, war: 0.01 };
/** Chance that a ship sailing through is attacked. */
export const CONFLICT_ATTACK: Record<ConflictLevel, number> = { elevated: 0.02, high: 0.06, war: 0.15 };

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** Replaces the game's conflict zones (from the admin's list) and reports changes as news. */
export function applyConflicts(state: GameState, zones: ConflictZone[]) {
  if (!state.settings.realConflicts) {
    state.conflicts = [];
    return;
  }
  const prev = new Map((state.conflicts ?? []).map((z) => [z.id, z]));
  for (const z of zones) {
    const old = prev.get(z.id);
    if (!old)
      news(
        state,
        sentence(`${z.name} is now ${CONFLICT_LEVEL_TEXT[z.level]}${z.note ? `: ${z.note.trim()}` : ''}`),
        'bad',
        'conflict',
      );
    else if (old.level !== z.level) {
      const worse = LEVEL_RANK[z.level] > LEVEL_RANK[old.level];
      news(
        state,
        `${z.name} ${worse ? 'escalates' : 'calms down'}: now ${CONFLICT_LEVEL_TEXT[z.level]}.`,
        worse ? 'bad' : 'good',
        'conflict',
      );
    }
  }
  for (const old of prev.values())
    if (!zones.some((z) => z.id === old.id))
      news(state, `${old.name} is no longer considered a conflict zone.`, 'good', 'conflict');
  state.conflicts = zones.map((z) => ({ ...z }));
}

/** The first conflict zone (not yet faced this voyage) that contains the ship. */
function conflictAt(state: GameState, ship: Ship): ConflictZone | null {
  const zones = state.conflicts;
  if (!zones?.length || !state.settings.realConflicts || !ship.voyage) return null;
  const route = shipRoute(ship);
  if (!route) return null;
  const pos = pointAlong(route, ship.voyage.progressNm);
  for (const z of zones) {
    if (ship.voyage.conflictsMet?.includes(z.id)) continue;
    if (haversineNm(pos.lon, pos.lat, z.lon, z.lat) <= z.radiusNm) return z;
  }
  return null;
}

export function brentFuelIndex(usd: number): number {
  return Math.min(3, Math.max(0.4, usd / BASE_BRENT));
}

/** The first real storm (not yet met this voyage) whose danger area contains the ship. */
function stormAt(state: GameState, ship: Ship): Storm | null {
  const storms = state.storms;
  if (!storms?.length || !state.settings.realWeather || !ship.voyage) return null;
  const route = shipRoute(ship);
  if (!route) return null;
  const pos = pointAlong(route, ship.voyage.progressNm);
  for (const st of storms) {
    if (ship.voyage.stormsMet?.includes(st.id)) continue;
    if (haversineNm(pos.lon, pos.lat, st.lon, st.lat) <= st.radiusNm) return st;
  }
  return null;
}

// ---------------------------------------------------------------- time

function daily(ctx: Ctx) {
  const s = ctx.state;
  const rng = ctx.rng;
  for (const player of Object.values(s.players)) {
    if (player.bankrupt) continue;
    let cost = 0;
    for (const ship of Object.values(s.ships)) {
      if (ship.owner !== player.id) continue;
      const cls = getShipClass(ship.classId);
      cost += cls.opex;
      if (ship.status === 'in_port') cost += berthFee(getPort(ship.port), cls);
    }
    cost += (player.loan * s.settings.interestRate) / 365;
    if (player.cash < 0) cost += (-player.cash * 0.18) / 365;
    spend(ctx, player, Math.round(cost));
    if (netWorth(s, player) < -2_000_000) {
      player.bankrupt = true;
      for (const ship of Object.values(s.ships)) if (ship.owner === player.id) delete s.ships[ship.id];
      ctx.log({
        player: null,
        text: `${player.company} has gone bankrupt! The bank seized the fleet.`,
        kind: 'bad',
        topic: 'company',
      });
      ctx.notices.push({ player: player.id, text: 'Your company has gone bankrupt.', action: false });
    }
  }
  // Markets: mean-reverting random walks.
  const walk = (v: number, vol: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v * Math.exp((rng.next() - 0.5) * 2 * vol + (1 - v) * 0.02)));
  const realFuel = !!(s.settings.realFuel && s.market.brent);
  s.market.fuelIndex = realFuel ? brentFuelIndex(s.market.brent!) : walk(s.market.fuelIndex, 0.025, 0.5, 2.2);
  s.market.shipIndex = walk(s.market.shipIndex, 0.01, 0.6, 1.6);
  for (const t of Object.keys(s.market.freight) as (keyof typeof s.market.freight)[])
    s.market.freight[t] = walk(s.market.freight[t], 0.02, 0.6, 1.8);
  if (!realFuel && rng.chance(0.004)) {
    s.market.fuelIndex = Math.min(2.2, s.market.fuelIndex * 1.35);
    ctx.log({ player: null, text: 'OIL CRISIS! Bunker prices soar worldwide.', kind: 'bad', topic: 'fuel' });
  }
  const dayInt = Math.floor(s.day);
  if (dayInt % 30 === 0) refreshUsedMarket(ctx);
  for (const [id, exp] of Object.entries(s.takenOffers)) if (exp < s.day) delete s.takenOffers[id];
  if (s.settings.durationDays > 0 && s.day >= s.settings.durationDays) finish(ctx);
}

function finish(ctx: Ctx) {
  const s = ctx.state;
  s.status = 'finished';
  const ranked = rankings(s);
  s.winner = ranked[0]?.id ?? null;
  ctx.log({
    player: null,
    text: `The game is over! ${ranked[0] ? `${ranked[0].company} wins with ${formatMoney(ranked[0].netWorth)}.` : ''}`,
    kind: 'good',
    topic: 'game',
  });
  for (const p of Object.values(s.players))
    ctx.notices.push({ player: p.id, text: 'The game has ended.', action: false });
}

function stepShip(ctx: Ctx, ship: Ship, dt: number) {
  const s = ctx.state;
  if (ship.pending) {
    if (s.day >= ship.pending.deadlineDay) {
      const choice = DEFAULT_CHOICE[ship.pending.kind];
      ctx.log(
        {
          player: ship.owner,
          ship: ship.id,
          text: `No orders received — ${ship.name}'s captain chose to ${choice}.`,
          kind: 'info',
        },
        true,
      );
      resolve(ctx, ship, choice);
    }
    return;
  }
  switch (ship.status) {
    case 'at_sea': {
      const v = ship.voyage!;
      if (s.day < v.holdUntil) return;
      const cls = getShipClass(ship.classId);
      const move = v.speed * 24 * dt;
      ship.fuel = Math.max(0, ship.fuel - fuelPerDay(cls, v.speed) * dt);
      v.progressNm = Math.min(v.distance, v.progressNm + move);
      ship.condition = Math.max(1, ship.condition - 0.05 * dt * (1 + shipAgeYears(ship, s.day) / 20));
      const storm = stormAt(s, ship);
      if (storm) {
        (v.stormsMet ??= []).push(storm.id);
        const rng = new Rng(hashParts(s.seed, ship.id, storm.id));
        const detourDays =
          Math.round(rng.range(storm.severity === 'red' ? 2 : 1, storm.severity === 'red' ? 3.5 : 2) * 10) /
          10;
        raise(
          ctx,
          ship,
          {
            kind: 'weather',
            stormId: storm.id,
            stormName: storm.name,
            severity: storm.severity,
            detourDays,
            seed: rng.int(1, 2 ** 30),
          },
          `${ship.name} is running into ${storm.name}${storm.windKmh ? ` (winds ${Math.round(storm.windKmh)} km/h)` : ''}. Sail through or go around (+${detourDays} days)?`,
        );
        return;
      }
      const zone = conflictAt(s, ship);
      if (zone) {
        (v.conflictsMet ??= []).push(zone.id);
        const rng = new Rng(hashParts(s.seed, ship.id, zone.id, Math.floor(v.departDay * 100)));
        const premium = Math.max(
          1000,
          Math.round((shipValue(ship, s.market, s.day) * CONFLICT_PREMIUM[zone.level]) / 1000) * 1000,
        );
        raise(
          ctx,
          ship,
          {
            kind: 'conflict',
            zoneId: zone.id,
            place: zone.name,
            level: zone.level,
            detourDays: zone.detourDays,
            premium,
            seed: rng.int(1, 2 ** 30),
          },
          `${ship.name} is approaching ${zone.name}, ${CONFLICT_LEVEL_TEXT[zone.level]}. Pay ${formatMoney(premium)} war-risk cover and sail through, or avoid it (+${zone.detourDays} days)?`,
        );
        return;
      }
      for (const ev of v.events) {
        if (ev.fired || ev.atNm > v.progressNm) continue;
        ev.fired = true;
        fireEvent(ctx, ship, ev);
        if (ship.pending) return;
      }
      if (v.progressNm >= v.distance) arrive(ctx, ship);
      break;
    }
    case 'loading':
      if (s.day >= ship.statusUntil)
        depart(ctx, ship, ship.cargo!.to, ship.plannedSpeed ?? getShipClass(ship.classId).speed);
      break;
    case 'docking':
      if (s.day >= ship.statusUntil) finishDocking(ctx, ship);
      break;
    case 'unloading':
      if (s.day >= ship.statusUntil) finishUnloading(ctx, ship);
      break;
    case 'repairing':
      if (s.day >= ship.statusUntil) {
        ctx.log(
          {
            player: ship.owner,
            ship: ship.id,
            text: `${ship.name} left drydock at ${Math.round(ship.condition)}% condition.`,
            kind: 'good',
          },
          true,
        );
        becomeIdle(ctx, ship);
      }
      break;
  }
}

/** Advances the game clock to `toDay`, processing ships, events and daily upkeep. */
export function advance(state: GameState, toDay: number): Notice[] {
  const ctx = new Ctx(state);
  if (state.status !== 'running') return ctx.notices;
  while (state.day < toDay && state.status === 'running') {
    const nextDaily = Math.floor(state.day) + 1;
    const dt = Math.min(STEP, toDay - state.day, nextDaily - state.day);
    state.day += dt;
    for (const ship of Object.values(state.ships)) stepShip(ctx, ship, dt);
    if (state.day >= nextDaily - 1e-9) {
      state.day = nextDaily;
      state.lastDailyDay = nextDaily;
      daily(ctx);
    }
  }
  return ctx.notices;
}

// ---------------------------------------------------------------- commands

export function applyCommand(
  state: GameState,
  playerId: string,
  cmd: Command,
): { result: CommandResult; notices: Notice[] } {
  const ctx = new Ctx(state);
  const result = run(ctx, playerId, cmd);
  return { result, notices: ctx.notices };
}

function run(ctx: Ctx, playerId: string, cmd: Command): CommandResult {
  const s = ctx.state;
  const player = s.players[playerId];
  if (!player) return { ok: false, error: 'You are not in this game' };
  if (player.bankrupt) return { ok: false, error: 'Your company is bankrupt' };
  if (s.status === 'finished') return { ok: false, error: 'The game is over' };
  if (s.status === 'paused' && cmd.type !== 'setCompany') return { ok: false, error: 'The game is paused' };
  const getShip = (id: string): Ship | string => {
    const ship = s.ships[id];
    if (!ship || ship.owner !== playerId) return 'No such ship';
    return ship;
  };
  const cleanName = (n: string) =>
    String(n ?? '')
      .replace(/[^\p{L}\p{N} .'-]/gu, '')
      .trim()
      .slice(0, 24);
  switch (cmd.type) {
    case 'setCompany': {
      const company = cleanName(cmd.company);
      if (company.length < 2) return { ok: false, error: 'Name too short' };
      player.company = company;
      if (cmd.color !== undefined && PLAYER_COLORS.includes(cmd.color)) player.color = cmd.color;
      return { ok: true };
    }
    case 'buyShip': {
      const cls = SHIP_CLASSES_BY_ID[cmd.classId];
      if (!cls) return { ok: false, error: 'Unknown ship type' };
      if (!PORTS.some((p) => p.id === cmd.port)) return { ok: false, error: 'Unknown port' };
      const price = newShipPrice(cls.id, s.market);
      if (player.cash < price)
        return { ok: false, error: `You need ${formatMoney(price)} (have ${formatMoney(player.cash)})` };
      const name = cleanName(cmd.name) || `${player.company.split(' ')[0]} ${cls.name.split(' ')[0]}`;
      spend(ctx, player, price);
      const ship = newShip(s, playerId, cls.id, name, cmd.port, s.day, 100);
      ctx.log({
        player: playerId,
        ship: ship.id,
        text: `${player.company} took delivery of the new ${cls.name} ${name} in ${getPort(cmd.port).name}.`,
        kind: 'good',
      });
      ctx.log({
        player: null,
        text: `${player.company} bought a new ${cls.name}.`,
        kind: 'info',
        topic: 'company',
      });
      return { ok: true };
    }
    case 'buyUsed': {
      const i = s.usedShips.findIndex((l) => l.id === cmd.listingId);
      if (i < 0) return { ok: false, error: 'That ship has already been sold' };
      const l = s.usedShips[i];
      if (player.cash < l.price) return { ok: false, error: `You need ${formatMoney(l.price)}` };
      spend(ctx, player, l.price);
      s.usedShips.splice(i, 1);
      const cls = getShipClass(l.classId);
      const name = cleanName(cmd.name) || `Old ${cls.name.split(' ')[0]}`;
      newShip(s, playerId, l.classId, name, l.port, l.builtDay, l.condition);
      ctx.log({
        player: null,
        text: `${player.company} bought a second-hand ${cls.name} in ${getPort(l.port).name}.`,
        kind: 'info',
        topic: 'company',
      });
      return { ok: true };
    }
    case 'sellShip': {
      const ship = getShip(cmd.shipId);
      if (typeof ship === 'string') return { ok: false, error: ship };
      if (ship.status !== 'in_port' || ship.cargo)
        return { ok: false, error: 'Ship must be idle in port to sell' };
      const value = Math.round(shipValue(ship, s.market, s.day) * 0.95);
      player.cash += value;
      delete s.ships[ship.id];
      ctx.log({ player: playerId, text: `${ship.name} was sold for ${formatMoney(value)}.`, kind: 'info' });
      return { ok: true };
    }
    case 'renameShip': {
      const ship = getShip(cmd.shipId);
      if (typeof ship === 'string') return { ok: false, error: ship };
      const name = cleanName(cmd.name);
      if (name.length < 2) return { ok: false, error: 'Name too short' };
      ship.name = name;
      return { ok: true };
    }
    case 'refuel': {
      const ship = getShip(cmd.shipId);
      if (typeof ship === 'string') return { ok: false, error: ship };
      if (!['in_port', 'loading', 'unloading', 'repairing'].includes(ship.status))
        return { ok: false, error: 'Ship must be in port' };
      const cls = getShipClass(ship.classId);
      const tons = Math.floor(Math.min(Number(cmd.tons) || 0, cls.tank - ship.fuel));
      if (tons <= 0) return { ok: false, error: 'Tanks are full' };
      const cost = tons * fuelPrice(getPort(ship.port), s.market);
      if (player.cash < cost) return { ok: false, error: `Bunkers cost ${formatMoney(cost)}` };
      spend(ctx, player, cost);
      ship.fuel += tons;
      return { ok: true, message: `Bunkered ${tons} t for ${formatMoney(cost)}` };
    }
    case 'repair': {
      const ship = getShip(cmd.shipId);
      if (typeof ship === 'string') return { ok: false, error: ship };
      if (ship.status !== 'in_port') return { ok: false, error: 'Ship must be idle in port' };
      const target = Math.min(100, Math.round(Number(cmd.target) || 0));
      const pts = target - ship.condition;
      if (pts <= 0) return { ok: false, error: 'Nothing to repair' };
      const cost = Math.round(pts * repairCostPerPoint(getShipClass(ship.classId)));
      if (player.cash < cost) return { ok: false, error: `Repairs cost ${formatMoney(cost)}` };
      spend(ctx, player, cost);
      ship.condition = target;
      ship.status = 'repairing';
      ship.statusUntil = s.day + pts / REPAIR_POINTS_PER_DAY;
      ship.idleSince = undefined;
      ctx.log({
        player: playerId,
        ship: ship.id,
        text: `${ship.name} entered drydock (${formatMoney(cost)}, ${(pts / REPAIR_POINTS_PER_DAY).toFixed(1)} days).`,
        kind: 'info',
      });
      return { ok: true };
    }
    case 'charter':
    case 'sail': {
      const ship = getShip(cmd.shipId);
      if (typeof ship === 'string') return { ok: false, error: ship };
      if (ship.status !== 'in_port') return { ok: false, error: 'Ship must be idle in port' };
      const cls = getShipClass(ship.classId);
      const speed = Number(cmd.speed);
      if (!(speed >= minSpeed(ship) && speed <= maxSpeed(ship)))
        return { ok: false, error: `Speed must be ${minSpeed(ship)}–${maxSpeed(ship)} kn` };
      let to: string;
      if (cmd.type === 'charter') {
        const offer = offersAt(s, ship.port).find((o) => o.offerId === cmd.offerId);
        if (!offer) return { ok: false, error: 'That charter is no longer available' };
        if (offer.type !== cls.cargo) return { ok: false, error: `A ${cls.name} cannot carry that cargo` };
        if (offer.tons > cls.capacity) return { ok: false, error: 'Cargo too large for this ship' };
        to = offer.to;
        const need = fuelNeeded(
          cls,
          findRoute(getPort(ship.port), getPort(to), routeOptsFor(cls)).distance,
          speed,
        );
        if (ship.fuel < need)
          return { ok: false, error: `Not enough fuel: need ${need} t, have ${Math.floor(ship.fuel)} t` };
        s.takenOffers[offer.offerId] = offer.expiresDay;
        ship.cargo = {
          offerId: offer.offerId,
          type: offer.type,
          tons: offer.tons,
          from: offer.from,
          to: offer.to,
          pay: offer.pay,
          dueDay: offer.dueDay,
          penaltyPerDay: offer.penaltyPerDay,
        };
        ship.status = 'loading';
        ship.statusUntil = s.day + handlingDays(ship.port, offer.type, offer.tons);
        ship.plannedSpeed = speed;
        ship.idleSince = undefined;
        ctx.log({
          player: playerId,
          ship: ship.id,
          text: `${ship.name} is loading ${offer.tons.toLocaleString('en')} t for ${getPort(to).name} (${formatMoney(offer.pay)}).`,
          kind: 'info',
        });
        return { ok: true };
      }
      to = cmd.to;
      if (!PORTS.some((p) => p.id === to) || to === ship.port)
        return { ok: false, error: 'Invalid destination' };
      const need = fuelNeeded(
        cls,
        findRoute(getPort(ship.port), getPort(to), routeOptsFor(cls)).distance,
        speed,
      );
      if (ship.fuel < need)
        return { ok: false, error: `Not enough fuel: need ${need} t, have ${Math.floor(ship.fuel)} t` };
      depart(ctx, ship, to, speed);
      return { ok: true };
    }
    case 'borrow': {
      const amount = Math.round(Number(cmd.amount) || 0);
      const room = loanLimit(s, player) - player.loan;
      if (amount <= 0) return { ok: false, error: 'Invalid amount' };
      if (amount > room)
        return { ok: false, error: `The bank will lend you at most ${formatMoney(Math.max(0, room))} more` };
      player.loan += amount;
      player.cash += amount;
      return { ok: true };
    }
    case 'repay': {
      const amount = Math.round(Math.min(Number(cmd.amount) || 0, player.loan, Math.max(0, player.cash)));
      if (amount <= 0) return { ok: false, error: 'Nothing to repay' };
      player.loan -= amount;
      player.cash -= amount;
      return { ok: true };
    }
    case 'decide': {
      const ship = getShip(cmd.shipId);
      if (typeof ship === 'string') return { ok: false, error: ship };
      return resolve(
        ctx,
        ship,
        cmd.choice,
        Array.isArray(cmd.inputs) ? cmd.inputs.slice(0, 20000).map((n) => Number(n) | 0) : undefined,
      );
    }
  }
  return { ok: false, error: 'Unknown command' };
}

function newShip(
  s: GameState,
  owner: string,
  classId: string,
  name: string,
  port: string,
  builtDay: number,
  condition: number,
): Ship {
  const cls = getShipClass(classId);
  const ship: Ship = {
    id: nextId(s, 's'),
    owner,
    name,
    classId,
    builtDay,
    condition,
    fuel: Math.round(cls.tank * 0.3),
    status: 'in_port',
    port,
    statusUntil: 0,
    voyage: null,
    cargo: null,
    pending: null,
    idleSince: s.day,
  };
  s.ships[ship.id] = ship;
  return ship;
}

// ---------------------------------------------------------------- admin / lifecycle

/**
 * One-time upgrade for games saved before games had a real start time (they counted from 1 Jan of a
 * start year). Anchors the game so that its day at `clockTs` (the real time it was last advanced to)
 * is that real instant; ships, money and progress are untouched. Returns true if the state changed.
 */
export function migrateGameState(state: GameState, clockTs: number): boolean {
  if (typeof state.startTs === 'number' && Number.isFinite(state.startTs)) return false;
  state.startTs =
    state.status === 'lobby' && state.day === 0 ? clockTs : clockTs - Math.round(state.day * DAY_MS);
  delete state.settings.startYear;
  return true;
}

/** Starts (or resumes) a game. A game that has not started yet begins at `now`, the real current time. */
export function startGame(state: GameState, now = Date.now()) {
  if (state.status === 'lobby' && state.day === 0) state.startTs = now;
  if (state.status === 'lobby' || state.status === 'paused') state.status = 'running';
}

export function pauseGame(state: GameState) {
  if (state.status === 'running') state.status = 'paused';
}

export function endGame(state: GameState): Notice[] {
  const ctx = new Ctx(state);
  if (state.status !== 'finished') finish(ctx);
  return ctx.notices;
}

export function removePlayer(state: GameState, playerId: string) {
  for (const ship of Object.values(state.ships)) if (ship.owner === playerId) delete state.ships[ship.id];
  delete state.players[playerId];
}

// ---------------------------------------------------------------- views

export interface RankRow {
  id: string;
  name: string;
  company: string;
  color: number;
  netWorth: number;
  ships: number;
  bankrupt: boolean;
}

export function rankings(state: GameState): RankRow[] {
  return Object.values(state.players)
    .map((p) => ({
      id: p.id,
      name: p.name,
      company: p.company,
      color: p.color,
      netWorth: p.bankrupt ? 0 : netWorth(state, p),
      ships: Object.values(state.ships).filter((s) => s.owner === p.id).length,
      bankrupt: p.bankrupt,
    }))
    .sort((a, b) => b.netWorth - a.netWorth);
}

export interface PendingAction {
  shipId: string;
  shipName: string;
  kind: 'orders' | PendingDecision['kind'];
  text: string;
  sinceDay: number;
  deadlineDay: number | null;
}

export function pendingActions(state: GameState, playerId: string): PendingAction[] {
  const out: PendingAction[] = [];
  if (state.status === 'finished') return out;
  for (const ship of Object.values(state.ships)) {
    if (ship.owner !== playerId) continue;
    if (ship.pending) {
      const labels = {
        pilot: 'is waiting for a pilot',
        pirates: 'is under pirate threat',
        hazard: 'needs a navigation decision',
        distress: 'received a distress call',
        weather: 'is heading into a storm',
        conflict: 'is approaching a conflict zone',
      };
      out.push({
        shipId: ship.id,
        shipName: ship.name,
        kind: ship.pending.kind,
        text: `${ship.name} ${labels[ship.pending.kind]}`,
        sinceDay: ship.pending.sinceDay,
        deadlineDay: ship.pending.deadlineDay,
      });
    } else if (ship.status === 'in_port') {
      out.push({
        shipId: ship.id,
        shipName: ship.name,
        kind: 'orders',
        text: `${ship.name} awaits orders in ${getPort(ship.port).name}`,
        sinceDay: ship.idleSince ?? state.day,
        deadlineDay: null,
      });
    }
  }
  return out.sort((a, b) => a.sinceDay - b.sinceDay);
}

export interface PrivateView {
  player: PlayerState;
  ships: Ship[];
  pending: PendingAction[];
  netWorth: number;
  fleetValue: number;
  loanLimit: number;
}

export function privateView(state: GameState, playerId: string): PrivateView | null {
  const player = state.players[playerId];
  if (!player) return null;
  return {
    player,
    ships: Object.values(state.ships).filter((s) => s.owner === playerId),
    pending: pendingActions(state, playerId),
    netWorth: netWorth(state, player),
    fleetValue: fleetValue(state, playerId),
    loanLimit: loanLimit(state, player),
  };
}
