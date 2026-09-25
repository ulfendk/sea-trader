import type { Storm } from '@sea-trader/shared';
import { config } from './config.js';

/**
 * Real-world data feeds:
 * - severe storms: GDACS (Global Disaster Alert and Coordination System) tropical cyclone alerts, no key needed;
 * - Brent crude price: US EIA open data API (free key in EIA_API_KEY).
 * Games opt in per game (settings.realWeather / realFuel); without data they fall back to simulation.
 */

export interface FeedStatus {
  storms: Storm[];
  stormsAt: number | null;
  stormsError: string | null;
  brent: number | null;
  brentDate: string | null;
  brentAt: number | null;
  brentError: string | null;
}

export const feeds: FeedStatus = {
  storms: [],
  stormsAt: null,
  stormsError: null,
  brent: null,
  brentDate: null,
  brentAt: null,
  brentError: null,
};

const STORM_EVERY_MS = 30 * 60_000;
const BRENT_EVERY_MS = 6 * 3600_000;

type Json = Record<string, unknown>;

/** Extracts current Orange/Red tropical cyclones from a GDACS event list (GeoJSON). */
export function parseGdacs(json: unknown): Storm[] {
  const features = ((json as Json)?.features as Json[]) ?? [];
  const latest = new Map<string, { storm: Storm; episode: number }>();
  const now = Date.now();
  for (const f of features) {
    const p = (f.properties ?? {}) as Json;
    if (String(p.eventtype ?? '').toUpperCase() !== 'TC') continue;
    const level = String(p.alertlevel ?? '').toLowerCase();
    if (level !== 'orange' && level !== 'red') continue;
    const toDate = Date.parse(String(p.todate ?? ''));
    const current =
      p.iscurrent === true ||
      String(p.iscurrent).toLowerCase() === 'true' ||
      (Number.isFinite(toDate) && now - toDate < 2 * 86400_000);
    if (!current) continue;
    const [lon, lat] = centre((f.geometry ?? {}) as Json);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const sev = (p.severitydata ?? {}) as Json;
    const unit = String(sev.severityunit ?? 'km/h').toLowerCase();
    let wind = Number(sev.severity) || 0;
    if (unit.includes('kt') || unit.includes('knot')) wind *= 1.852;
    else if (unit.includes('mph')) wind *= 1.609;
    const red = level === 'red';
    const radiusNm = (red ? 280 : 200) + (wind >= 180 ? 60 : 0);
    const rawName = String(p.name ?? p.eventname ?? 'Tropical cyclone').replace(/-\d+$/, '');
    const name = /^[A-Z-]+$/.test(rawName) ? rawName.charAt(0) + rawName.slice(1).toLowerCase() : rawName;
    const id = `gdacs-${p.eventid ?? `${lon.toFixed(1)},${lat.toFixed(1)}`}`;
    const episode = Number(p.episodeid) || 0;
    const prev = latest.get(id);
    if (prev && prev.episode > episode) continue;
    latest.set(id, {
      episode,
      storm: {
        id,
        name: /cyclone|storm|hurricane|typhoon/i.test(name) ? name : `Cyclone ${name}`,
        lon,
        lat,
        radiusNm,
        severity: red ? 'red' : 'orange',
        windKmh: Math.round(wind),
      },
    });
  }
  return [...latest.values()].map((v) => v.storm);
}

function centre(geometry: Json): [number, number] {
  const coords = geometry.coordinates as unknown;
  if (geometry.type === 'Point' && Array.isArray(coords)) return [Number(coords[0]), Number(coords[1])];
  // Polygons or lines: average all points.
  const pts: number[][] = [];
  const walk = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === 'number') pts.push(c as number[]);
    else if (Array.isArray(c)) c.forEach(walk);
  };
  walk(coords);
  if (!pts.length) return [NaN, NaN];
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}

/** Reads the latest daily Brent price from an EIA v2 API response. */
export function parseEia(json: unknown): { usd: number; date: string } | null {
  const data = (((json as Json)?.response as Json)?.data as Json[]) ?? [];
  for (const row of data) {
    const usd = Number(row.value);
    if (usd > 0) return { usd, date: String(row.period ?? '') };
  }
  return null;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function refreshStorms(): Promise<boolean> {
  try {
    feeds.storms = parseGdacs(await getJson(config.stormFeedUrl));
    feeds.stormsAt = Date.now();
    feeds.stormsError = null;
    return true;
  } catch (e) {
    feeds.stormsError = (e as Error).message;
    console.warn('storm feed failed:', feeds.stormsError);
    return false;
  }
}

export async function refreshBrent(): Promise<boolean> {
  const url =
    config.brentFeedUrl ||
    (config.eiaApiKey
      ? `https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${encodeURIComponent(config.eiaApiKey)}&frequency=daily&data[0]=value&facets[series][]=RBRTE&sort[0][column]=period&sort[0][direction]=desc&length=5`
      : '');
  if (!url) {
    feeds.brentError = 'EIA_API_KEY is not set';
    return false;
  }
  try {
    const got = parseEia(await getJson(url));
    if (!got) throw new Error('no price in response');
    feeds.brent = got.usd;
    feeds.brentDate = got.date;
    feeds.brentAt = Date.now();
    feeds.brentError = null;
    return true;
  } catch (e) {
    feeds.brentError = (e as Error).message.replace(config.eiaApiKey || '\u0000', '***');
    console.warn('Brent feed failed:', feeds.brentError);
    return false;
  }
}

/** Starts periodic refreshes; `onUpdate` is called after each successful refresh. */
export function startFeeds(onUpdate: () => void): () => void {
  if (!config.feedsEnabled) return () => undefined;
  const storms = async () => (await refreshStorms()) && onUpdate();
  const brent = async () => (await refreshBrent()) && onUpdate();
  void storms();
  void brent();
  const a = setInterval(() => void storms(), STORM_EVERY_MS);
  const b = setInterval(() => void brent(), BRENT_EVERY_MS);
  return () => {
    clearInterval(a);
    clearInterval(b);
  };
}
