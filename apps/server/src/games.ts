import { and, desc, eq, inArray } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { matchMaker } from '@colyseus/core';
import {
  createGame as createGameState,
  formatDate,
  pendingActions,
  type GameSettings,
  type GameState,
  type Notice,
} from '@sea-trader/shared';
import { config } from './config.js';
import { db, schema } from './db/index.js';
import { sendPush } from './push.js';
import type { GameRoom } from './rooms/GameRoom.js';

/** Live rooms keyed by game id (single-process deployment). */
export const liveRooms = new Map<string, GameRoom>();

export async function createGame(name: string, settings: Partial<GameSettings>) {
  const state = createGameState(randomInt(1, 2 ** 31), settings);
  const [row] = await db
    .insert(schema.games)
    .values({ name: name.slice(0, 60), status: state.status, state, clockTs: Date.now() })
    .returning();
  await ensureRoom(row.id);
  return row;
}

export async function loadGame(id: string) {
  const rows = await db.select().from(schema.games).where(eq(schema.games.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function saveGame(id: string, state: GameState, clockTs: number) {
  await db
    .update(schema.games)
    .set({ state, status: state.status, clockTs, updatedAt: new Date() })
    .where(eq(schema.games.id, id));
}

export async function ensureRoom(gameId: string): Promise<GameRoom | undefined> {
  if (liveRooms.has(gameId)) return liveRooms.get(gameId);
  await matchMaker.createRoom('game', { gameId });
  return liveRooms.get(gameId);
}

export async function bootRooms() {
  const rows = await db.select({ id: schema.games.id, status: schema.games.status }).from(schema.games);
  for (const r of rows) {
    if (r.status === 'finished') continue;
    try {
      await ensureRoom(r.id);
    } catch (e) {
      console.error(`Failed to start room for game ${r.id}`, e);
    }
  }
}

export async function isMember(gameId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(schema.gameMembers)
    .where(and(eq(schema.gameMembers.gameId, gameId), eq(schema.gameMembers.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

export async function addMember(gameId: string, userId: string, displayName: string) {
  await db.insert(schema.gameMembers).values({ gameId, userId }).onConflictDoNothing();
  const room = liveRooms.get(gameId) ?? (await ensureRoom(gameId));
  if (room) room.addMember(userId, displayName);
  else {
    // Finished game or room unavailable: update stored state directly.
    const g = await loadGame(gameId);
    if (g) {
      const { addPlayer } = await import('@sea-trader/shared');
      const st = g.state as GameState;
      addPlayer(st, userId, displayName);
      await saveGame(gameId, st, g.clockTs);
    }
  }
}

export async function removeMember(gameId: string, userId: string) {
  await db
    .delete(schema.gameMembers)
    .where(and(eq(schema.gameMembers.gameId, gameId), eq(schema.gameMembers.userId, userId)));
  liveRooms.get(gameId)?.removeMember(userId);
}

/** Current game state: live room if running, otherwise the stored snapshot. */
export async function currentState(gameId: string): Promise<{ name: string; state: GameState } | null> {
  const room = liveRooms.get(gameId);
  if (room) return { name: room.gameName, state: room.game };
  const g = await loadGame(gameId);
  return g ? { name: g.name, state: g.state as GameState } : null;
}

export async function gamesForUser(userId: string) {
  const rows = await db
    .select({ id: schema.games.id, name: schema.games.name, status: schema.games.status })
    .from(schema.gameMembers)
    .innerJoin(schema.games, eq(schema.games.id, schema.gameMembers.gameId))
    .where(eq(schema.gameMembers.userId, userId))
    .orderBy(desc(schema.games.createdAt));
  const out = [];
  for (const r of rows) {
    const cur = await currentState(r.id);
    if (!cur) continue;
    const st = cur.state;
    const player = st.players[userId];
    out.push({
      id: r.id,
      name: cur.name,
      status: st.status,
      day: st.day,
      date: formatDate(st.day, st.settings.startYear),
      company: player?.company ?? '',
      cash: player?.cash ?? 0,
      players: Object.keys(st.players).length,
      pending: player ? pendingActions(st, userId) : [],
    });
  }
  return out;
}

/** Stores notices, and pushes the ones that need the player's attention. */
export async function handleNotices(gameId: string, gameName: string, notices: Notice[]) {
  if (!notices.length) return;
  await db.insert(schema.notifications).values(
    notices.map((n) => ({
      userId: n.player,
      gameId,
      shipId: n.ship ?? null,
      text: n.text,
      action: n.action,
    })),
  );
  const byUser = new Map<string, Notice[]>();
  for (const n of notices) if (n.action) byUser.set(n.player, [...(byUser.get(n.player) ?? []), n]);
  for (const [userId, list] of byUser) {
    const body =
      list.length === 1
        ? list[0].text
        : `${list.length} ships need orders: ${list.map((n) => n.text).join(' ')}`;
    await sendPush([userId], {
      title: `⚓ ${gameName}`,
      body: body.slice(0, 300),
      url: `${config.publicUrl}/game/${gameId}${list[0].ship ? `?ship=${list[0].ship}` : ''}`,
      tag: `${gameId}:${list[0].ship ?? ''}`,
    });
  }
}

export async function recentNotifications(userId: string, limit = 30) {
  return db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.id))
    .limit(limit);
}

export async function pruneNotifications() {
  const cutoff = new Date(Date.now() - 30 * 86400_000);
  const { lt } = await import('drizzle-orm');
  await db.delete(schema.notifications).where(lt(schema.notifications.createdAt, cutoff));
}

export async function memberIds(gameId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.gameMembers.userId })
    .from(schema.gameMembers)
    .where(eq(schema.gameMembers.gameId, gameId));
  return rows.map((r) => r.userId);
}

export async function userNames(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db
    .select({ id: schema.users.id, displayName: schema.users.displayName })
    .from(schema.users)
    .where(inArray(schema.users.id, ids));
  return new Map(rows.map((r) => [r.id, r.displayName]));
}
