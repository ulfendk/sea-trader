import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { db, schema } from './db/index.js';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  sessionId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export const hashPassword = (pw: string) => hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export function validUsername(u: unknown): u is string {
  return typeof u === 'string' && /^[a-zA-Z0-9_.-]{3,24}$/.test(u);
}
export function validPassword(p: unknown): p is string {
  return typeof p === 'string' && p.length >= 8 && p.length <= 200;
}

export async function createSession(
  userId: string,
  kind: 'web' | 'api',
  label: string,
): Promise<{ token: string; id: string }> {
  const token = newToken();
  const expiresAt = kind === 'web' ? new Date(Date.now() + config.sessionDays * 86400_000) : null;
  const [row] = await db
    .insert(schema.sessions)
    .values({ userId, tokenHash: hashToken(token), kind, label: label.slice(0, 80), expiresAt })
    .returning({ id: schema.sessions.id });
  return { token, id: row.id };
}

const touchCache = new Map<string, number>();

/** Resolves a bearer token to a user (or null). */
export async function userFromToken(token: string | undefined | null): Promise<AuthUser | null> {
  if (!token) return null;
  const rows = await db
    .select({
      sessionId: schema.sessions.id,
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      isAdmin: schema.users.isAdmin,
      disabled: schema.users.disabled,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(
        eq(schema.sessions.tokenHash, hashToken(token)),
        or(isNull(schema.sessions.expiresAt), gt(schema.sessions.expiresAt, new Date())),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || row.disabled) return null;
  // Touch at most once a minute per session.
  const last = touchCache.get(row.sessionId) ?? 0;
  if (Date.now() - last > 60_000) {
    touchCache.set(row.sessionId, Date.now());
    await db
      .update(schema.sessions)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.sessions.id, row.sessionId));
    await db.update(schema.users).set({ lastSeenAt: new Date() }).where(eq(schema.users.id, row.id));
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    isAdmin: row.isAdmin,
    sessionId: row.sessionId,
  };
}

export function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await userFromToken(bearer(req));
    if (!user) return res.status(401).json({ error: 'Not logged in' });
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admins only' });
  next();
}

/** Simple in-memory rate limiter for login attempts. */
const attempts = new Map<string, { n: number; until: number }>();
export function loginThrottle(key: string): boolean {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.until > now && a.n >= 10) return false;
  if (!a || a.until <= now) attempts.set(key, { n: 1, until: now + 15 * 60_000 });
  else a.n++;
  return true;
}
export function loginSucceeded(key: string) {
  attempts.delete(key);
}

export async function ensureAdmin() {
  if (!config.adminUsername || !config.adminPassword) return;
  const username = config.adminUsername.toLowerCase();
  const existing = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);
  if (existing.length) {
    if (!existing[0].isAdmin)
      await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, existing[0].id));
    return;
  }
  await db.insert(schema.users).values({
    username,
    displayName: config.adminUsername,
    passwordHash: await hashPassword(config.adminPassword),
    isAdmin: true,
  });
  console.log(`Created admin user "${username}"`);
}
