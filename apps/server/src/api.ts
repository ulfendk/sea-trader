import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import {
  DEFAULT_CONFLICT_ZONES,
  DEFAULT_SETTINGS,
  gameTime,
  pendingActions,
  startTsOf,
  type GameSettings,
} from '@sea-trader/shared';
import {
  bearer,
  createSession,
  hashPassword,
  loginSucceeded,
  loginThrottle,
  requireAdmin,
  requireUser,
  userFromToken,
  validPassword,
  validUsername,
  verifyPassword,
} from './auth.js';
import { config } from './config.js';
import { db, schema } from './db/index.js';
import {
  addMember,
  createGame,
  currentState,
  ensureRoom,
  gamesForUser,
  liveRooms,
  loadGame,
  memberIds,
  recentNotifications,
  removeMember,
  userNames,
} from './games.js';
import { vapidPublicKey } from './push.js';
import { feeds } from './feeds.js';
import { cleanZones, conflictZones, resetConflictZones, saveConflictZones } from './conflicts.js';

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const bad = (res: Response, error: string, code = 400) => res.status(code).json({ error });

const publicUser = (u: typeof schema.users.$inferSelect) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  isAdmin: u.isAdmin,
  disabled: u.disabled,
  createdAt: u.createdAt,
  lastSeenAt: u.lastSeenAt,
});

async function redeemInvite(code: string, userId: string, displayName: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.code, code.trim().toUpperCase()))
    .limit(1);
  const inv = rows[0];
  if (!inv) return 'Unknown invite code';
  if (inv.expiresAt && inv.expiresAt < new Date()) return 'Invite has expired';
  if (inv.uses >= inv.maxUses) return 'Invite has been used up';
  await db
    .update(schema.invites)
    .set({ uses: sql`${schema.invites.uses} + 1` })
    .where(eq(schema.invites.code, inv.code));
  if (inv.gameId) {
    const g = await loadGame(inv.gameId);
    if (!g) return 'Game no longer exists';
    const st = g.state as { players: Record<string, unknown>; settings: GameSettings };
    const members = await memberIds(inv.gameId);
    if (!members.includes(userId) && members.length >= st.settings.maxPlayers) return 'The game is full';
    await addMember(inv.gameId, userId, displayName);
  }
  return null;
}

function cleanSettings(input: unknown): Partial<GameSettings> {
  const out: Partial<GameSettings> = {};
  if (!input || typeof input !== 'object') return out;
  const src = input as Record<string, unknown>;
  const num = (k: keyof GameSettings, min: number, max: number) => {
    const v = Number(src[k]);
    if (src[k] !== undefined && src[k] !== '' && Number.isFinite(v))
      (out as Record<string, number>)[k] = Math.min(max, Math.max(min, v));
  };
  num('timeScale', 0.1, 100000);
  num('startingCash', 0, 1e10);
  num('maxPlayers', 1, 32);
  num('actionDeadlineHours', 0.1, 24 * 30);
  num('durationDays', 0, 365 * 100);
  num('eventRate', 0, 10);
  num('interestRate', 0, 1);
  for (const k of ['realWeather', 'realFuel', 'realConflicts'] as const)
    if (typeof src[k] === 'boolean') out[k] = src[k] as boolean;
  return out;
}

export function apiRouter(): Router {
  const r = express.Router();
  r.use(express.json({ limit: '256kb' }));

  r.get('/health', (_req, res) => {
    res.json({ ok: true, rooms: liveRooms.size });
  });

  r.get('/config', (_req, res) => {
    res.json({ openRegistration: config.openRegistration, vapidPublicKey: vapidPublicKey() });
  });

  // ---------------------------------------------------------------- auth
  r.post(
    '/auth/register',
    h(async (req, res) => {
      const { username, password, invite, displayName } = req.body ?? {};
      if (!validUsername(username)) return bad(res, 'Username: 3-24 letters, digits, _ . -');
      if (!validPassword(password)) return bad(res, 'Password must be at least 8 characters');
      if (!invite && !config.openRegistration) return bad(res, 'An invite code is required');
      const name =
        String(displayName || username)
          .trim()
          .slice(0, 24) || username;
      const lower = username.toLowerCase();
      if (invite) {
        const inv = await db
          .select()
          .from(schema.invites)
          .where(eq(schema.invites.code, String(invite).trim().toUpperCase()))
          .limit(1);
        if (!inv[0] || inv[0].uses >= inv[0].maxUses || (inv[0].expiresAt && inv[0].expiresAt < new Date()))
          return bad(res, 'Invalid or used invite code');
      }
      const exists = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.username, lower))
        .limit(1);
      if (exists.length) return bad(res, 'Username is taken');
      const [user] = await db
        .insert(schema.users)
        .values({ username: lower, displayName: name, passwordHash: await hashPassword(password) })
        .returning();
      if (invite) {
        const err = await redeemInvite(String(invite), user.id, name);
        if (err) console.warn('invite redeem after register failed:', err);
      }
      const session = await createSession(
        user.id,
        'web',
        String(req.body?.device ?? req.headers['user-agent'] ?? 'browser'),
      );
      res.json({ token: session.token, user: publicUser(user) });
    }),
  );

  r.post(
    '/auth/login',
    h(async (req, res) => {
      const { username, password } = req.body ?? {};
      if (typeof username !== 'string' || typeof password !== 'string')
        return bad(res, 'Missing credentials');
      const key = `${req.ip}:${username.toLowerCase()}`;
      if (!loginThrottle(key)) return bad(res, 'Too many attempts, try again later', 429);
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, username.toLowerCase()))
        .limit(1);
      const user = rows[0];
      if (!user || user.disabled || !(await verifyPassword(user.passwordHash, password)))
        return bad(res, 'Wrong username or password', 401);
      loginSucceeded(key);
      const session = await createSession(
        user.id,
        'web',
        String(req.body?.device ?? req.headers['user-agent'] ?? 'browser'),
      );
      res.json({ token: session.token, user: publicUser(user) });
    }),
  );

  r.post(
    '/auth/logout',
    h(async (req, res) => {
      const user = await userFromToken(bearer(req));
      if (user) await db.delete(schema.sessions).where(eq(schema.sessions.id, user.sessionId));
      res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------------- me
  r.get(
    '/me',
    requireUser,
    h(async (req, res) => {
      const u = req.user!;
      res.json({
        user: { id: u.id, username: u.username, displayName: u.displayName, isAdmin: u.isAdmin },
        games: await gamesForUser(u.id),
      });
    }),
  );

  r.patch(
    '/me',
    requireUser,
    h(async (req, res) => {
      const { displayName, password, oldPassword } = req.body ?? {};
      const u = req.user!;
      if (displayName !== undefined) {
        const name = String(displayName).trim().slice(0, 24);
        if (name.length < 2) return bad(res, 'Name too short');
        await db.update(schema.users).set({ displayName: name }).where(eq(schema.users.id, u.id));
      }
      if (password !== undefined) {
        if (!validPassword(password)) return bad(res, 'Password must be at least 8 characters');
        const [row] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
        if (!(await verifyPassword(row.passwordHash, String(oldPassword ?? ''))))
          return bad(res, 'Current password is wrong');
        await db
          .update(schema.users)
          .set({ passwordHash: await hashPassword(password) })
          .where(eq(schema.users.id, u.id));
      }
      res.json({ ok: true });
    }),
  );

  r.get(
    '/sessions',
    requireUser,
    h(async (req, res) => {
      const rows = await db
        .select({
          id: schema.sessions.id,
          kind: schema.sessions.kind,
          label: schema.sessions.label,
          createdAt: schema.sessions.createdAt,
          lastUsedAt: schema.sessions.lastUsedAt,
        })
        .from(schema.sessions)
        .where(eq(schema.sessions.userId, req.user!.id))
        .orderBy(desc(schema.sessions.lastUsedAt));
      res.json(rows.map((s) => ({ ...s, current: s.id === req.user!.sessionId })));
    }),
  );

  r.delete(
    '/sessions/:id',
    requireUser,
    h(async (req, res) => {
      await db
        .delete(schema.sessions)
        .where(and(eq(schema.sessions.id, String(req.params.id)), eq(schema.sessions.userId, req.user!.id)));
      res.json({ ok: true });
    }),
  );

  /** Long-lived API token for the status bar / scripts. */
  r.post(
    '/tokens',
    requireUser,
    h(async (req, res) => {
      const label = String(req.body?.label ?? 'Status bar').slice(0, 80) || 'Status bar';
      const s = await createSession(req.user!.id, 'api', label);
      res.json({ token: s.token, id: s.id });
    }),
  );

  r.post(
    '/invites/redeem',
    requireUser,
    h(async (req, res) => {
      const err = await redeemInvite(String(req.body?.code ?? ''), req.user!.id, req.user!.displayName);
      if (err) return bad(res, err);
      res.json({ ok: true, games: await gamesForUser(req.user!.id) });
    }),
  );

  // ---------------------------------------------------------------- push
  r.post(
    '/push/subscribe',
    requireUser,
    h(async (req, res) => {
      const sub = req.body?.subscription;
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return bad(res, 'Invalid subscription');
      await db
        .insert(schema.pushSubscriptions)
        .values({
          userId: req.user!.id,
          endpoint: sub.endpoint,
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth,
        })
        .onConflictDoUpdate({
          target: schema.pushSubscriptions.endpoint,
          set: { userId: req.user!.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
        });
      res.json({ ok: true });
    }),
  );

  r.post(
    '/push/unsubscribe',
    requireUser,
    h(async (req, res) => {
      if (req.body?.endpoint)
        await db
          .delete(schema.pushSubscriptions)
          .where(eq(schema.pushSubscriptions.endpoint, String(req.body.endpoint)));
      res.json({ ok: true });
    }),
  );

  // ---------------------------------------------------------------- status bar
  r.get(
    '/status',
    requireUser,
    h(async (req, res) => {
      const games = await gamesForUser(req.user!.id);
      const pending = games.flatMap((g) =>
        g.pending.map((p) => ({
          gameId: g.id,
          game: g.name,
          ship: p.shipName,
          shipId: p.shipId,
          kind: p.kind,
          text: p.text,
          deadlineDay: p.deadlineDay,
        })),
      );
      const urgent = pending.filter((p) => p.kind !== 'orders');
      const notifications = (await recentNotifications(req.user!.id, 15)).map((n) => ({
        id: n.id,
        gameId: n.gameId,
        text: n.text,
        action: n.action,
        at: n.createdAt,
      }));
      res.json({
        user: req.user!.displayName,
        count: pending.length,
        urgent: urgent.length,
        pending,
        games: games.map((g) => ({
          id: g.id,
          name: g.name,
          status: g.status,
          time: g.time,
          pending: g.pending.length,
        })),
        notifications,
        url: config.publicUrl,
      });
    }),
  );

  r.get(
    '/notifications',
    requireUser,
    h(async (req, res) => {
      res.json(await recentNotifications(req.user!.id, 50));
    }),
  );

  // ---------------------------------------------------------------- admin
  const a = express.Router();
  a.use(requireUser, requireAdmin);

  a.get(
    '/overview',
    h(async (_req, res) => {
      const [{ users }] = await db.select({ users: sql<number>`count(*)::int` }).from(schema.users);
      res.json({
        uptime: process.uptime(),
        rooms: [...liveRooms.values()].map((r) => r.info()),
        users,
        defaults: DEFAULT_SETTINGS,
        feeds: {
          storms: feeds.storms,
          stormsAt: feeds.stormsAt,
          stormsError: feeds.stormsError,
          brent: feeds.brent,
          brentDate: feeds.brentDate,
          brentAt: feeds.brentAt,
          brentError: feeds.brentError,
          enabled: config.feedsEnabled,
        },
      });
    }),
  );

  a.get(
    '/games',
    h(async (_req, res) => {
      const rows = await db
        .select({
          id: schema.games.id,
          name: schema.games.name,
          status: schema.games.status,
          createdAt: schema.games.createdAt,
        })
        .from(schema.games)
        .orderBy(desc(schema.games.createdAt));
      const out = [];
      for (const g of rows) {
        const cur = await currentState(g.id);
        if (!cur) continue;
        const st = cur.state;
        const names = await userNames(await memberIds(g.id));
        out.push({
          id: g.id,
          name: cur.name,
          status: st.status,
          createdAt: g.createdAt,
          day: st.day,
          startTs: startTsOf(st),
          time: gameTime(startTsOf(st), st.day),
          settings: st.settings,
          live: liveRooms.has(g.id),
          clients: liveRooms.get(g.id)?.clients.length ?? 0,
          members: [...names.entries()].map(([id, name]) => {
            const p = st.players[id];
            return {
              id,
              name,
              company: p?.company ?? '',
              cash: p?.cash ?? 0,
              ships: Object.values(st.ships).filter((s) => s.owner === id).length,
              pending: p ? pendingActions(st, id).length : 0,
              bankrupt: p?.bankrupt ?? false,
            };
          }),
        });
      }
      res.json(out);
    }),
  );

  a.post(
    '/games',
    h(async (req, res) => {
      const name = String(req.body?.name ?? '').trim();
      if (name.length < 2) return bad(res, 'Name required');
      const row = await createGame(name, cleanSettings(req.body?.settings));
      if (req.body?.joinSelf) await addMember(row.id, req.user!.id, req.user!.displayName);
      res.json({ id: row.id });
    }),
  );

  a.patch(
    '/games/:id',
    h(async (req, res) => {
      const id = String(req.params.id);
      const room = liveRooms.get(id) ?? (await ensureRoom(id).catch(() => undefined));
      if (!room) return bad(res, 'Game not running', 404);
      const name = req.body?.name ? String(req.body.name).trim().slice(0, 60) : undefined;
      if (name) await db.update(schema.games).set({ name }).where(eq(schema.games.id, id));
      await room.updateSettings(cleanSettings(req.body?.settings), name);
      res.json({ ok: true });
    }),
  );

  a.post(
    '/games/:id/:action',
    h(async (req, res) => {
      const id = String(req.params.id);
      const action = String(req.params.action);
      const room = liveRooms.get(id) ?? (await ensureRoom(id).catch(() => undefined));
      if (!room) return bad(res, 'Game not running', 404);
      if (action === 'start' || action === 'pause' || action === 'end') await room.setStatus(action);
      else if (action === 'skip') {
        const days = Math.min(365, Math.max(0.01, Number(req.body?.days) || 1));
        await room.skipDays(days);
      } else if (action === 'members') {
        const userId = String(req.body?.userId ?? '');
        const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
        if (!u) return bad(res, 'Unknown user');
        await addMember(id, u.id, u.displayName);
      } else return bad(res, 'Unknown action', 404);
      res.json({ ok: true });
    }),
  );

  a.delete(
    '/games/:id/members/:userId',
    h(async (req, res) => {
      await removeMember(String(req.params.id), String(req.params.userId));
      res.json({ ok: true });
    }),
  );

  a.delete(
    '/games/:id',
    h(async (req, res) => {
      const id = String(req.params.id);
      const room = liveRooms.get(id);
      if (room) {
        liveRooms.delete(id);
        room.autoDispose = true;
        room.gameId = '';
        await room.disconnect();
      }
      await db.delete(schema.games).where(eq(schema.games.id, id));
      res.json({ ok: true });
    }),
  );

  a.get(
    '/users',
    h(async (_req, res) => {
      const rows = await db.select().from(schema.users).orderBy(asc(schema.users.username));
      res.json(rows.map(publicUser));
    }),
  );

  a.post(
    '/users',
    h(async (req, res) => {
      const { username, password, displayName, isAdmin } = req.body ?? {};
      if (!validUsername(username)) return bad(res, 'Invalid username');
      if (!validPassword(password)) return bad(res, 'Password must be at least 8 characters');
      const lower = username.toLowerCase();
      const exists = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.username, lower));
      if (exists.length) return bad(res, 'Username is taken');
      const [u] = await db
        .insert(schema.users)
        .values({
          username: lower,
          displayName: String(displayName || username).slice(0, 24),
          passwordHash: await hashPassword(password),
          isAdmin: !!isAdmin,
        })
        .returning();
      res.json(publicUser(u));
    }),
  );

  a.patch(
    '/users/:id',
    h(async (req, res) => {
      const id = String(req.params.id);
      const { password, isAdmin, disabled, displayName } = req.body ?? {};
      const set: Partial<typeof schema.users.$inferInsert> = {};
      if (password !== undefined) {
        if (!validPassword(password)) return bad(res, 'Password must be at least 8 characters');
        set.passwordHash = await hashPassword(password);
      }
      if (isAdmin !== undefined) set.isAdmin = !!isAdmin;
      if (disabled !== undefined) set.disabled = !!disabled;
      if (displayName) set.displayName = String(displayName).slice(0, 24);
      if (id === req.user!.id && (set.isAdmin === false || set.disabled))
        return bad(res, 'You cannot demote or disable yourself');
      if (Object.keys(set).length) await db.update(schema.users).set(set).where(eq(schema.users.id, id));
      if (password !== undefined || disabled)
        await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
      res.json({ ok: true });
    }),
  );

  a.delete(
    '/users/:id',
    h(async (req, res) => {
      const id = String(req.params.id);
      if (id === req.user!.id) return bad(res, 'You cannot delete yourself');
      const games = await db
        .select({ gameId: schema.gameMembers.gameId })
        .from(schema.gameMembers)
        .where(eq(schema.gameMembers.userId, id));
      for (const g of games) await removeMember(g.gameId, id);
      await db.delete(schema.users).where(eq(schema.users.id, id));
      res.json({ ok: true });
    }),
  );

  a.get(
    '/invites',
    h(async (_req, res) => {
      res.json(await db.select().from(schema.invites).orderBy(desc(schema.invites.createdAt)));
    }),
  );

  a.post(
    '/invites',
    h(async (req, res) => {
      const code = randomBytes(5).toString('hex').toUpperCase();
      const gameId = req.body?.gameId ? String(req.body.gameId) : null;
      const maxUses = Math.min(100, Math.max(1, Number(req.body?.maxUses) || 1));
      const days = Number(req.body?.expiresDays) || 0;
      const [inv] = await db
        .insert(schema.invites)
        .values({
          code,
          gameId,
          maxUses,
          expiresAt: days > 0 ? new Date(Date.now() + days * 86400_000) : null,
        })
        .returning();
      res.json(inv);
    }),
  );

  a.delete(
    '/invites/:code',
    h(async (req, res) => {
      await db.delete(schema.invites).where(eq(schema.invites.code, String(req.params.code)));
      res.json({ ok: true });
    }),
  );

  a.get(
    '/conflicts',
    h(async (_req, res) => {
      res.json({ zones: conflictZones(), defaults: DEFAULT_CONFLICT_ZONES });
    }),
  );

  a.put(
    '/conflicts',
    h(async (req, res) => {
      await saveConflictZones(cleanZones(req.body?.zones));
      for (const room of liveRooms.values()) room.applyFeeds();
      res.json({ zones: conflictZones() });
    }),
  );

  a.post(
    '/conflicts/reset',
    h(async (_req, res) => {
      await resetConflictZones();
      for (const room of liveRooms.values()) room.applyFeeds();
      res.json({ zones: conflictZones() });
    }),
  );

  r.use('/admin', a);

  r.use((_req, res) => bad(res, 'Not found', 404));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    bad(res, 'Server error', 500);
  });
  return r;
}
