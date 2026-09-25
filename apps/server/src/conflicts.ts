import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { DEFAULT_CONFLICT_ZONES, type ConflictLevel, type ConflictZone } from '@sea-trader/shared';
import { db, schema } from './db/index.js';

/**
 * Conflict zones are maintained by the admin (there is no reliable open feed for maritime
 * war-risk areas). They are stored in the settings table and applied to every game that uses them.
 */

const KEY = 'conflictZones';
const LEVELS: ConflictLevel[] = ['elevated', 'high', 'war'];
const MAX_ZONES = 50;

let zones: ConflictZone[] = DEFAULT_CONFLICT_ZONES.map((z) => ({ ...z }));

export function conflictZones(): ConflictZone[] {
  return zones;
}

export async function loadConflictZones() {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, KEY)).limit(1);
  if (row) zones = cleanZones(row.value);
}

export async function saveConflictZones(list: ConflictZone[]) {
  zones = list;
  await db
    .insert(schema.settings)
    .values({ key: KEY, value: list })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: list } });
}

export async function resetConflictZones() {
  zones = DEFAULT_CONFLICT_ZONES.map((z) => ({ ...z }));
  await db.delete(schema.settings).where(eq(schema.settings.key, KEY));
}

const clamp = (v: unknown, min: number, max: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

/** Validates an admin-supplied zone list; invalid entries are dropped. */
export function cleanZones(input: unknown): ConflictZone[] {
  if (!Array.isArray(input)) return [];
  const out: ConflictZone[] = [];
  const ids = new Set<string>();
  for (const raw of input.slice(0, MAX_ZONES)) {
    if (!raw || typeof raw !== 'object') continue;
    const z = raw as Record<string, unknown>;
    const name = String(z.name ?? '')
      .trim()
      .slice(0, 60);
    if (!name) continue;
    let id = String(z.id ?? '')
      .replace(/[^a-z0-9-]/gi, '')
      .slice(0, 40);
    if (!id || ids.has(id)) id = `zone-${randomBytes(4).toString('hex')}`;
    ids.add(id);
    const level = LEVELS.includes(z.level as ConflictLevel) ? (z.level as ConflictLevel) : 'elevated';
    const note = String(z.note ?? '')
      .trim()
      .slice(0, 200);
    out.push({
      id,
      name,
      lon: Math.round(clamp(z.lon, -180, 180, 0) * 100) / 100,
      lat: Math.round(clamp(z.lat, -80, 80, 0) * 100) / 100,
      radiusNm: Math.round(clamp(z.radiusNm, 20, 1500, 200)),
      level,
      detourDays: Math.round(clamp(z.detourDays, 0, 60, 1) * 10) / 10,
      ...(note ? { note } : {}),
    });
  }
  return out;
}
