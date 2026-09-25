import { Client, type Room } from '@colyseus/sdk';
import { signal } from '@preact/signals';
import type {
  CharterOffer,
  Command,
  CommandResult,
  GameSettings,
  LogEntry,
  Market,
  PrivateView,
  UsedShipListing,
} from '@sea-trader/shared';
import { DAY_MS } from '@sea-trader/shared';
import { token } from './api';
import { COLYSEUS_URL } from './env';

export interface PubPlayer {
  id: string;
  name: string;
  company: string;
  color: number;
  netWorth: number;
  ships: number;
  bankrupt: boolean;
  online: number;
}
export interface PubShip {
  id: string;
  owner: string;
  name: string;
  classId: string;
  status: string;
  port: string;
  from: string;
  to: string;
  progressNm: number;
  distance: number;
  speed: number;
  holdUntil: number;
  waiting: boolean;
}
export interface PubState {
  gameId: string;
  name: string;
  day: number;
  serverTs: number;
  status: string;
  timeScale: number;
  startYear: number;
  durationDays: number;
  fuelIndex: number;
  shipIndex: number;
  players: Record<string, PubPlayer>;
  ships: Record<string, PubShip>;
  news: { day: number; text: string; kind: string }[];
  winner: string;
}
export interface PrivatePayload {
  me: PrivateView | null;
  settings: GameSettings;
  market: Market;
  usedShips: UsedShipListing[];
  log: LogEntry[];
  isAdmin: boolean;
}

export const pub = signal<PubState | null>(null);
export const priv = signal<PrivatePayload | null>(null);
export const connection = signal<'idle' | 'connecting' | 'online' | 'reconnecting' | 'error'>('idle');
export const connError = signal<string>('');
export const offers = signal<Record<string, { day: number; offers: CharterOffer[]; at: number }>>({});

let room: Room | null = null;
let currentGame = '';
let dayAnchor = { day: 0, at: Date.now() };
let reqId = 1;
const waiting = new Map<number, (r: CommandResult) => void>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Continuous game day, interpolated between server ticks. */
export function liveDay(): number {
  const p = pub.value;
  if (!p) return 0;
  if (p.status !== 'running') return p.day;
  return dayAnchor.day + ((Date.now() - dayAnchor.at) / DAY_MS) * p.timeScale;
}

export async function connectGame(gameId: string) {
  if (currentGame === gameId && room) return;
  await leaveGame();
  currentGame = gameId;
  connection.value = 'connecting';
  connError.value = '';
  try {
    const client = new Client(COLYSEUS_URL);
    client.http.authToken = token.value ?? undefined;
    const r = await client.joinOrCreate('game', { gameId });
    if (currentGame !== gameId) {
      await r.leave();
      return;
    }
    room = r;
    connection.value = 'online';
    r.onStateChange((state: { toJSON(): PubState }) => {
      const json = state.toJSON();
      if (!pub.value || pub.value.day !== json.day) dayAnchor = { day: json.day, at: Date.now() };
      pub.value = json;
    });
    r.onMessage('private', (m: PrivatePayload) => (priv.value = m));
    r.onMessage('cmdResult', (m: { id: number; result: CommandResult }) => {
      waiting.get(m.id)?.(m.result);
      waiting.delete(m.id);
    });
    r.onMessage('offers', (m: { port: string; day: number; offers: CharterOffer[] }) => {
      offers.value = { ...offers.value, [m.port]: { day: m.day, offers: m.offers, at: Date.now() } };
    });
    r.onDrop(() => (connection.value = 'reconnecting'));
    r.onReconnect(() => (connection.value = 'online'));
    r.onLeave((code: number) => {
      if (room !== r) return;
      room = null;
      if (currentGame === gameId && code !== 1000) {
        connection.value = 'reconnecting';
        retryTimer = setTimeout(() => {
          currentGame = '';
          void connectGame(gameId);
        }, 3000);
      }
    });
  } catch (e) {
    connection.value = 'error';
    connError.value = e instanceof Error ? e.message : String(e);
    currentGame = '';
  }
}

export async function leaveGame() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const r = room;
  room = null;
  currentGame = '';
  pub.value = null;
  priv.value = null;
  offers.value = {};
  connection.value = 'idle';
  if (r) await r.leave(true).catch(() => undefined);
}

export function cmd(command: Command): Promise<CommandResult> {
  if (!room) return Promise.resolve({ ok: false, error: 'Not connected' });
  const id = reqId++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    room!.send('cmd', { id, cmd: command });
    setTimeout(() => {
      if (waiting.has(id)) {
        waiting.delete(id);
        resolve({ ok: false, error: 'Timed out' });
      }
    }, 15000);
  });
}

export function requestOffers(port: string) {
  room?.send('offers', { port });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentGame && !room) {
    const g = currentGame;
    currentGame = '';
    void connectGame(g);
  }
});
