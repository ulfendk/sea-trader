import { Room, type Client, type AuthContext } from '@colyseus/core';
import {
  addPlayer,
  advance,
  applyCommand,
  DAY_MS,
  endGame,
  offersAt,
  pauseGame,
  privateView,
  rankings,
  removePlayer,
  startGame,
  startTsOf,
  PORTS_BY_ID,
  type Command,
  type GameSettings,
  type GameState,
  type Notice,
} from '@sea-trader/shared';
import { userFromToken, type AuthUser } from '../auth.js';
import { config } from '../config.js';
import { handleNotices, isMember, liveRooms, loadGame, saveGame } from '../games.js';
import { GameStateSchema, NewsItem, PlayerPub, ShipPub } from './schema.js';

interface ClientData {
  userId: string;
  isAdmin: boolean;
  lastPrivate?: string;
}

const SAVE_EVERY_MS = 15_000;

export class GameRoom extends Room<{ state: GameStateSchema }> {
  autoDispose = false;
  maxClients = 200;
  patchRate = 250;

  gameId = '';
  gameName = '';
  game!: GameState;
  clockTs = Date.now();
  private dirty = false;
  private lastSave = Date.now();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  static async onAuth(token: string, options: { gameId?: string }, _context: AuthContext) {
    const user = await userFromToken(token);
    if (!user) throw new Error('Not logged in');
    if (!options?.gameId) throw new Error('Missing game');
    if (!user.isAdmin && !(await isMember(options.gameId, user.id)))
      throw new Error('You are not a member of this game');
    return user;
  }

  async onCreate(options: { gameId: string }) {
    const row = await loadGame(options.gameId);
    if (!row) throw new Error('Game not found');
    if (liveRooms.has(row.id)) throw new Error('Room already running');
    this.gameId = row.id;
    this.gameName = row.name;
    this.game = row.state as GameState;
    this.clockTs = row.clockTs;
    liveRooms.set(this.gameId, this);
    this.setState(new GameStateSchema());
    this.state.gameId = this.gameId;
    this.catchUp();
    this.sync();
    this.clock.setInterval(() => this.tick(), config.tickMs);

    this.onMessage('cmd', (client: Client, msg: { id: number; cmd: Command }) =>
      this.handleCommand(client, msg),
    );
    this.onMessage('offers', (client: Client, msg: { port: string }) => {
      if (!PORTS_BY_ID[msg?.port]) return;
      client.send('offers', { port: msg.port, day: this.game.day, offers: offersAt(this.game, msg.port) });
    });
  }

  onJoin(client: Client, _options: unknown, auth: AuthUser) {
    const data: ClientData = { userId: auth.id, isAdmin: auth.isAdmin };
    client.userData = data;
    this.updateOnline();
    this.sendPrivate(client, true);
  }

  onLeave(client: Client) {
    void client;
    this.updateOnline();
  }

  async onDispose() {
    if (!this.gameId) return; // game was deleted
    if (liveRooms.get(this.gameId) === this) liveRooms.delete(this.gameId);
    await this.save();
  }

  // ------------------------------------------------------------ clock

  /** Advances the game clock to the current wall-clock time. */
  private catchUp(): Notice[] {
    const now = Date.now();
    let notices: Notice[] = [];
    if (this.game.status === 'running') {
      const toDay = this.game.day + ((now - this.clockTs) / DAY_MS) * this.game.settings.timeScale;
      notices = advance(this.game, toDay);
      this.dirty = true;
    }
    this.clockTs = now;
    return notices;
  }

  private tick() {
    const notices = this.catchUp();
    this.afterChange(notices);
    if (this.dirty && Date.now() - this.lastSave > SAVE_EVERY_MS) void this.save();
  }

  private afterChange(notices: Notice[]) {
    this.sync();
    for (const c of this.clients) this.sendPrivate(c);
    if (notices.length)
      void handleNotices(this.gameId, this.gameName, notices).catch((e) => console.error('notice error', e));
  }

  async save() {
    if (!this.gameId) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.lastSave = Date.now();
    this.dirty = false;
    try {
      await saveGame(this.gameId, this.game, this.clockTs);
    } catch (e) {
      this.dirty = true;
      console.error('save failed', e);
    }
  }

  private scheduleSave() {
    this.dirty = true;
    if (!this.saveTimer) this.saveTimer = setTimeout(() => void this.save(), 2000);
  }

  // ------------------------------------------------------------ sync

  private sync() {
    const g = this.game;
    const s = this.state;
    s.name = this.gameName;
    s.day = g.day;
    s.serverTs = this.clockTs;
    s.status = g.status;
    s.timeScale = g.settings.timeScale;
    s.startTs = startTsOf(g);
    s.durationDays = g.settings.durationDays;
    s.fuelIndex = Math.round(g.market.fuelIndex * 1000) / 1000;
    s.shipIndex = Math.round(g.market.shipIndex * 1000) / 1000;
    s.winner = g.winner ?? '';

    const ranks = rankings(g);
    for (const r of ranks) {
      let p = s.players.get(r.id);
      if (!p) {
        p = new PlayerPub();
        p.id = r.id;
        p.online = 0;
        s.players.set(r.id, p);
      }
      p.name = r.name;
      p.company = r.company;
      p.color = r.color;
      p.netWorth = r.netWorth;
      p.ships = r.ships;
      p.bankrupt = r.bankrupt;
    }
    for (const id of [...s.players.keys()]) if (!g.players[id]) s.players.delete(id);

    for (const ship of Object.values(g.ships)) {
      let p = s.ships.get(ship.id);
      if (!p) {
        p = new ShipPub();
        p.id = ship.id;
        s.ships.set(ship.id, p);
      }
      p.owner = ship.owner;
      p.name = ship.name;
      p.classId = ship.classId;
      p.status = ship.status;
      p.port = ship.port;
      p.from = ship.voyage?.from ?? ship.port;
      p.to = ship.voyage?.to ?? ship.port;
      p.progressNm = Math.round((ship.voyage?.progressNm ?? 0) * 10) / 10;
      p.distance = ship.voyage?.distance ?? 0;
      p.speed = ship.voyage?.speed ?? 0;
      p.holdUntil = ship.voyage?.holdUntil ?? 0;
      p.waiting = !!ship.pending;
    }
    for (const id of [...s.ships.keys()]) if (!g.ships[id]) s.ships.delete(id);

    const news = g.log.filter((l) => l.player === null).slice(-25);
    const last = s.news.length ? s.news[s.news.length - 1] : null;
    const lastNews = news[news.length - 1];
    if (!last || !lastNews || last.day !== lastNews.day || last.text !== lastNews.text) {
      s.news.clear();
      for (const n of news) {
        const item = new NewsItem();
        item.day = n.day;
        item.text = n.text;
        item.kind = n.kind;
        s.news.push(item);
      }
    }
  }

  private updateOnline() {
    const counts = new Map<string, number>();
    for (const c of this.clients) {
      const d = c.userData as ClientData | undefined;
      if (d) counts.set(d.userId, (counts.get(d.userId) ?? 0) + 1);
    }
    for (const [id, p] of this.state.players) p.online = counts.get(id) ?? 0;
  }

  private sendPrivate(client: Client, force = false) {
    const d = client.userData as ClientData | undefined;
    if (!d) return;
    const view = privateView(this.game, d.userId);
    const payload = {
      me: view,
      settings: this.game.settings,
      market: this.game.market,
      usedShips: this.game.usedShips,
      log: this.game.log.filter((l) => l.player === d.userId).slice(-80),
      isAdmin: d.isAdmin,
    };
    const json = JSON.stringify(payload);
    if (!force && json === d.lastPrivate) return;
    d.lastPrivate = json;
    client.send('private', payload);
  }

  // ------------------------------------------------------------ commands

  private handleCommand(client: Client, msg: { id: number; cmd: Command }) {
    const d = client.userData as ClientData | undefined;
    if (!d || !msg?.cmd || typeof msg.cmd.type !== 'string') return;
    const pre = this.catchUp();
    const { result, notices } = applyCommand(this.game, d.userId, msg.cmd);
    client.send('cmdResult', { id: msg.id, result });
    if (result.ok) this.scheduleSave();
    this.afterChange([...pre, ...notices]);
  }

  // ------------------------------------------------------------ admin

  addMember(userId: string, name: string) {
    addPlayer(this.game, userId, name);
    this.scheduleSave();
    this.afterChange([]);
  }

  removeMember(userId: string) {
    removePlayer(this.game, userId);
    for (const c of this.clients) if ((c.userData as ClientData | undefined)?.userId === userId) c.leave();
    this.scheduleSave();
    this.afterChange([]);
  }

  async setStatus(action: 'start' | 'pause' | 'end') {
    const pre = this.catchUp();
    let notices: Notice[] = [];
    if (action === 'start') startGame(this.game, Date.now());
    if (action === 'pause') pauseGame(this.game);
    if (action === 'end') notices = endGame(this.game);
    this.afterChange([...pre, ...notices]);
    await this.save();
  }

  async updateSettings(settings: Partial<GameSettings>, name?: string) {
    this.catchUp();
    Object.assign(this.game.settings, settings);
    if (name) this.gameName = name;
    this.afterChange([]);
    await this.save();
  }

  /** Fast-forwards the game clock (admin/testing). */
  async skipDays(days: number) {
    const pre = this.catchUp();
    const notices = advance(this.game, this.game.day + days);
    this.afterChange([...pre, ...notices]);
    await this.save();
  }

  info() {
    return {
      gameId: this.gameId,
      name: this.gameName,
      status: this.game.status,
      day: this.game.day,
      clients: this.clients.length,
      players: Object.keys(this.game.players).length,
      ships: Object.keys(this.game.ships).length,
    };
  }
}
