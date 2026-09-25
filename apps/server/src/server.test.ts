import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/seatrader_test';
process.env.DATABASE_URL = DB;
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'admin-pass-123';
process.env.SERVE_WEB = 'false';
process.env.TICK_MS = '200';
process.env.CORS_ORIGINS = 'https://example.github.io';

const PORT = 25671;
const BASE = `http://localhost:${PORT}`;

let available = true;
try {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  await c.query(
    'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
  );
  await c.end();
} catch (e) {
  available = false;
  console.warn(`Skipping server tests: cannot reach ${DB} (${(e as Error).message})`);
}

async function j<T = any>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: T }> {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json().catch(() => null)) as T };
}

describe.runIf(available)('server', () => {
  let close: () => Promise<void>;
  let adminToken = '';

  beforeAll(async () => {
    const { startServer } = await import('./server.js');
    const s = await startServer(PORT);
    close = s.close;
    const r = await j<{ token: string }>('POST', '/auth/login', {
      username: 'admin',
      password: 'admin-pass-123',
    });
    adminToken = r.data.token;
  });
  afterAll(async () => {
    await close?.();
    const { pool } = await import('./db/index.js');
    await pool.end();
  });

  it('health and CORS', async () => {
    const res = await fetch(`${BASE}/api/health`, { headers: { origin: 'https://example.github.io' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://example.github.io');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    const bad = await fetch(`${BASE}/api/health`, { headers: { origin: 'https://evil.example' } });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    expect(bad.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('rejects bad logins and non-admins', async () => {
    expect((await j('POST', '/auth/login', { username: 'admin', password: 'nope' })).status).toBe(401);
    expect((await j('GET', '/me')).status).toBe(401);
    expect((await j('POST', '/auth/register', { username: 'eve', password: 'password123' })).status).toBe(
      400,
    );
  });

  it('runs the invite → register → play flow across two devices', async () => {
    const game = await j<{ id: string }>(
      'POST',
      '/admin/games',
      { name: 'Friends', settings: { timeScale: 100000 } },
      adminToken,
    );
    expect(game.status).toBe(200);
    const inv = await j<{ code: string }>(
      'POST',
      '/admin/invites',
      { gameId: game.data.id, maxUses: 1 },
      adminToken,
    );
    const reg = await j<{ token: string; user: { id: string } }>('POST', '/auth/register', {
      username: 'alice',
      password: 'alicepass1',
      invite: inv.data.code,
    });
    expect(reg.status).toBe(200);
    // invite is used up
    expect(
      (await j('POST', '/auth/register', { username: 'bob', password: 'bobpass12', invite: inv.data.code }))
        .status,
    ).toBe(400);
    await j('POST', `/admin/games/${game.data.id}/start`, {}, adminToken);

    const second = await j<{ token: string }>('POST', '/auth/login', {
      username: 'alice',
      password: 'alicepass1',
      device: 'phone',
    });
    const sessions = await j<unknown[]>('GET', '/sessions', undefined, reg.data.token);
    expect(sessions.data.length).toBe(2);

    const { Client } = await import('@colyseus/sdk');
    const c1 = new Client(BASE);
    c1.http.authToken = reg.data.token;
    const room = await c1.joinOrCreate('game', { gameId: game.data.id });
    const privs: any[] = [];
    room.onMessage('private', (m: any) => privs.push(m));
    const results: any[] = [];
    room.onMessage('cmdResult', (m: any) => results.push(m.result));
    await new Promise((r) => setTimeout(r, 500));
    expect(privs.at(-1).me.player.cash).toBe(6_000_000);

    room.send('cmd', { id: 1, cmd: { type: 'buyShip', classId: 'coaster', port: 'rtm', name: 'Alpha' } });
    await new Promise((r) => setTimeout(r, 500));
    expect(results[0]).toEqual({ ok: true });
    const ship = privs.at(-1).me.ships[0];
    room.send('cmd', { id: 2, cmd: { type: 'refuel', shipId: ship.id, tons: 300 } });
    room.send('cmd', { id: 3, cmd: { type: 'sail', shipId: ship.id, to: 'lon', speed: 12 } });
    await new Promise((r) => setTimeout(r, 500));
    expect(results.slice(1).every((r) => r.ok)).toBe(true);

    // The second device joins the same room and sees the same state.
    const c2 = new Client(BASE);
    c2.http.authToken = second.data.token;
    const room2 = await c2.joinOrCreate('game', { gameId: game.data.id });
    await new Promise((r) => setTimeout(r, 500));
    expect(room2.roomId).toBe(room.roomId);
    expect((room2.state as any).ships.get(ship.id).name).toBe('Alpha');

    // Time passes fast: the ship arrives and needs a decision.
    let status: any = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      status = (await j('GET', '/status', undefined, reg.data.token)).data;
      if (status.pending.some((p: any) => p.kind === 'pilot')) break;
    }
    expect(status.pending.some((p: any) => p.kind === 'pilot')).toBe(true);
    expect(status.notifications.length).toBeGreaterThan(0);

    // Non-members cannot join.
    const other = await j<{ token: string }>(
      'POST',
      '/admin/users',
      { username: 'mallory', password: 'mallory123' },
      adminToken,
    );
    expect(other.status).toBe(200);
    const mal = await j<{ token: string }>('POST', '/auth/login', {
      username: 'mallory',
      password: 'mallory123',
    });
    const c3 = new Client(BASE);
    c3.http.authToken = mal.data.token;
    await expect(c3.joinOrCreate('game', { gameId: game.data.id })).rejects.toBeTruthy();

    await room.leave();
    await room2.leave();
  });

  it('persists game state', async () => {
    const games = await j<any[]>('GET', '/admin/games', undefined, adminToken);
    const g = games.data.find((x) => x.name === 'Friends');
    expect(g.day).toBeGreaterThan(0);
    const { liveRooms } = await import('./games.js');
    await liveRooms.get(g.id)!.save();
    const { loadGame } = await import('./games.js');
    const row = await loadGame(g.id);
    expect((row!.state as any).ships).toBeTruthy();
    expect(Object.keys((row!.state as any).ships)).toHaveLength(1);
  });
});
