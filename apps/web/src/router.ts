import { signal } from '@preact/signals';
import { BASE } from './env';

function current(): string {
  const p = window.location.pathname;
  return (p.startsWith(BASE) ? p.slice(BASE.length) : p) || '/';
}

export const path = signal(current());
export const query = signal(new URLSearchParams(window.location.search));

export function navigate(to: string, replace = false) {
  const url = BASE + to;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  path.value = current();
  query.value = new URLSearchParams(window.location.search);
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', () => {
  path.value = current();
  query.value = new URLSearchParams(window.location.search);
});

export function match(pattern: string, p: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean);
  const b = p.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}
