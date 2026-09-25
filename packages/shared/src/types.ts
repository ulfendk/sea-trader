export type CargoType = 'general' | 'container' | 'bulk' | 'oil';

export type GameStatus = 'lobby' | 'running' | 'paused' | 'finished';

export interface GameSettings {
  /** @deprecated Games now start at the real date and time; kept only to read old saves. */
  startYear?: number;
  /** Game days per real day (1 = real time). */
  timeScale: number;
  startingCash: number;
  maxPlayers: number;
  /** Game-time hours a player has to answer a decision before the default is applied. */
  actionDeadlineHours: number;
  /** Game length in days; 0 = endless. */
  durationDays: number;
  /** Multiplier on random-event frequency. */
  eventRate: number;
  /** Annual loan interest rate (0.08 = 8%). */
  interestRate: number;
  /** Put real severe storms (GDACS alerts) in ships' way. Missing on older games = off. */
  realWeather?: boolean;
  /** Drive bunker prices from the real Brent crude price. Missing on older games = off. */
  realFuel?: boolean;
  /** Put the admin-managed conflict zones in ships' way. Missing on older games = off. */
  realConflicts?: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  timeScale: 1,
  startingCash: 6_000_000,
  maxPlayers: 8,
  actionDeadlineHours: 24,
  durationDays: 0,
  eventRate: 1,
  interestRate: 0.08,
  realWeather: true,
  realFuel: true,
  realConflicts: true,
};

/** A real severe storm (tropical cyclone) from the weather feed. */
export interface Storm {
  id: string;
  name: string;
  lon: number;
  lat: number;
  /** Radius (nm) of the area ships treat as dangerous. */
  radiusNm: number;
  severity: 'orange' | 'red';
  /** Maximum sustained wind (km/h), if known. */
  windKmh: number;
}

export type ConflictLevel = 'elevated' | 'high' | 'war';

/** A conflict zone (war risk, attacks, piracy) maintained by the server admin. */
export interface ConflictZone {
  id: string;
  name: string;
  lon: number;
  lat: number;
  radiusNm: number;
  level: ConflictLevel;
  /** Extra days a ship needs to avoid the zone (reroute or wait for an escort). */
  detourDays: number;
  /** Short background shown to players. */
  note?: string;
}

export interface PlayerState {
  id: string;
  name: string;
  company: string;
  color: number;
  cash: number;
  loan: number;
  joinedDay: number;
  bankrupt: boolean;
  stats: { revenue: number; voyages: number; expenses: number };
}

export interface Cargo {
  offerId: string;
  type: CargoType;
  tons: number;
  from: string;
  to: string;
  /** Total freight payment on delivery. */
  pay: number;
  /** Game day by which cargo must be delivered. */
  dueDay: number;
  /** Penalty per day late. */
  penaltyPerDay: number;
}

export interface CharterOffer extends Cargo {
  /** Last game day on which the offer can be accepted. */
  expiresDay: number;
  /** Rate per tonne (informational). */
  rate: number;
}

export type ShipStatus =
  | 'in_port' // idle, awaiting orders
  | 'loading'
  | 'at_sea'
  | 'awaiting_pilot' // arrived outside the harbour
  | 'docking'
  | 'unloading'
  | 'repairing';

export type VoyageEventKind = 'storm' | 'engine' | 'pirates' | 'hazard' | 'distress' | 'fire';

export interface VoyageEvent {
  kind: VoyageEventKind;
  /** Distance along the route (nm) at which the event fires. */
  atNm: number;
  fired?: boolean;
  /** Seed for any mini-game or outcome roll. */
  seed: number;
  /** Human-readable place name for hazards. */
  place?: string;
}

export interface Voyage {
  from: string;
  to: string;
  departDay: number;
  distance: number;
  speed: number;
  progressNm: number;
  /** Game days spent stopped (delays), informational. */
  delayDays: number;
  /** Remaining delay: ship does not move until this day. */
  holdUntil: number;
  events: VoyageEvent[];
  canals: string[];
  /** Real storms already met on this voyage (each is faced once). */
  stormsMet?: string[];
  /** Conflict zones already faced on this voyage (each is faced once). */
  conflictsMet?: string[];
}

export type DecisionKind = 'pilot' | 'pirates' | 'hazard' | 'distress' | 'weather' | 'conflict';

export interface PendingDecision {
  kind: DecisionKind;
  /** Game day when the decision was raised. */
  sinceDay: number;
  /** Game day at which the default option is applied automatically. */
  deadlineDay: number;
  /** Seed for mini-game layouts / outcome rolls. */
  seed: number;
  /** Extra info, e.g. ransom amount, detour days, place. */
  ransom?: number;
  detourDays?: number;
  place?: string;
  tugFee?: number;
  /** Real storm the ship is facing (weather decisions). */
  stormId?: string;
  stormName?: string;
  severity?: 'orange' | 'red';
  /** Conflict zone the ship is facing (conflict decisions). */
  zoneId?: string;
  level?: ConflictLevel;
  /** War-risk insurance premium for sailing through a conflict zone. */
  premium?: number;
}

export interface Ship {
  id: string;
  owner: string;
  name: string;
  classId: string;
  /** Game day the ship was built (negative = before game start). */
  builtDay: number;
  condition: number;
  fuel: number;
  status: ShipStatus;
  /** Current port (in port) or destination (at sea). */
  port: string;
  /** Game day at which a timed status (loading, unloading, docking, repairing) ends. */
  statusUntil: number;
  voyage: Voyage | null;
  cargo: Cargo | null;
  /** Speed chosen for the next departure (after loading). */
  plannedSpeed?: number;
  pending: PendingDecision | null;
  /** Day the ship became idle in port (for UI). */
  idleSince?: number;
}

export interface UsedShipListing {
  id: string;
  classId: string;
  builtDay: number;
  condition: number;
  port: string;
  price: number;
}

export interface LogEntry {
  day: number;
  /** Player id or null for public news. */
  player: string | null;
  ship?: string;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'action';
  /** Category of public news, for filtering. */
  topic?: NewsTopic;
}

export type NewsTopic = 'weather' | 'fuel' | 'conflict' | 'company' | 'game';

export interface Market {
  fuelIndex: number;
  /** Latest real Brent crude price (USD/bbl) and its date, when the fuel feed is available. */
  brent?: number;
  brentDate?: string;
  /** Brent price at the last fuel news item, to report notable moves only. */
  brentNews?: number;
  shipIndex: number;
  freight: Record<CargoType, number>;
}

export interface GameState {
  version: 1;
  seed: number;
  rng: number;
  /** Real-world instant (ms since epoch, UTC) that game day 0 corresponds to. Set when the game starts. */
  startTs: number;
  day: number;
  status: GameStatus;
  settings: GameSettings;
  players: Record<string, PlayerState>;
  ships: Record<string, Ship>;
  market: Market;
  usedShips: UsedShipListing[];
  /** Offer ids already accepted (key) -> expiry day. */
  takenOffers: Record<string, number>;
  lastDailyDay: number;
  nextId: number;
  log: LogEntry[];
  winner?: string | null;
  /** Current real severe storms (set by the server's weather feed). */
  storms?: Storm[];
  /** Current conflict zones (set by the server from the admin's list). */
  conflicts?: ConflictZone[];
}

/** Notice produced by the rules engine for the server to forward (push, status bar, feed). */
export interface Notice {
  player: string;
  ship?: string;
  text: string;
  /** True when the player must act. */
  action: boolean;
}

export type Command =
  | { type: 'buyShip'; classId: string; port: string; name: string }
  | { type: 'buyUsed'; listingId: string; name: string }
  | { type: 'sellShip'; shipId: string }
  | { type: 'renameShip'; shipId: string; name: string }
  | { type: 'refuel'; shipId: string; tons: number }
  | { type: 'repair'; shipId: string; target: number }
  | { type: 'charter'; shipId: string; offerId: string; speed: number }
  | { type: 'sail'; shipId: string; to: string; speed: number }
  | { type: 'borrow'; amount: number }
  | { type: 'repay'; amount: number }
  | { type: 'decide'; shipId: string; choice: string; inputs?: number[] }
  | { type: 'setCompany'; company: string; color?: number };

export type CommandResult = { ok: true; message?: string } | { ok: false; error: string };
