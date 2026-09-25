import { signal } from '@preact/signals';

export const toasts = signal<{ id: number; text: string; kind: 'ok' | 'err' | 'info' }[]>([]);
let n = 1;

export function toast(text: string, kind: 'ok' | 'err' | 'info' = 'info') {
  const id = n++;
  toasts.value = [...toasts.value, { id, text, kind }];
  setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), kind === 'err' ? 6000 : 3500);
}
