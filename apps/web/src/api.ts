import { signal } from '@preact/signals';
import { API_URL } from './env';

const TOKEN_KEY = 'seatrader.token';

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export const token = signal<string | null>(readToken());

export function setToken(t: string | null) {
  token.value = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_URL + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token.value ? { authorization: `Bearer ${token.value}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (res.status === 401 && token.value && !path.startsWith('/auth/')) setToken(null);
  if (!res.ok) throw new ApiError((data as { error?: string })?.error ?? `HTTP ${res.status}`, res.status);
  return data as T;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

export interface PendingAction {
  shipId: string;
  shipName: string;
  kind: string;
  text: string;
  sinceDay: number;
  deadlineDay: number | null;
}

export interface GameSummary {
  id: string;
  name: string;
  status: string;
  day: number;
  date: string;
  company: string;
  cash: number;
  players: number;
  pending: PendingAction[];
}

export const me = signal<{ user: User; games: GameSummary[] } | null>(null);

export async function refreshMe() {
  if (!token.value) {
    me.value = null;
    return;
  }
  try {
    me.value = await api('GET', '/me');
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) me.value = null;
    else throw e;
  }
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Mac/.test(ua)
        ? 'macOS'
        : /Linux/.test(ua)
          ? 'Linux'
          : /Windows/.test(ua)
            ? 'Windows'
            : 'Device';
  const br = /Firefox/.test(ua)
    ? 'Firefox'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /Chrome/.test(ua)
        ? 'Chrome'
        : /Safari/.test(ua)
          ? 'Safari'
          : 'Browser';
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches ? ' (app)' : '';
  return `${br} on ${os}${standalone}`;
}
