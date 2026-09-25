import { useEffect, useState } from 'preact/hooks';
import { formatDate } from '@sea-trader/shared';
import { liveDay, pub } from '../net';

export function useTicker(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function gameDateStr(day: number): string {
  return formatDate(day, pub.value?.startYear ?? 1990);
}

/** Real-world duration for a span of game days. */
export function realDuration(gameDays: number): string {
  const scale = pub.value?.timeScale ?? 1;
  const ms = Math.max(0, (gameDays / scale) * 86400_000);
  const m = Math.round(ms / 60000);
  if (m < 1) return `${Math.max(0, Math.round(ms / 1000))}s`;
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function daysLeft(targetDay: number): number {
  return targetDay - liveDay();
}

export const STATUS_LABEL: Record<string, string> = {
  in_port: 'In port — awaiting orders',
  loading: 'Loading cargo',
  at_sea: 'At sea',
  awaiting_pilot: 'Waiting outside harbour',
  docking: 'Docking',
  unloading: 'Unloading cargo',
  repairing: 'In drydock',
};

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
