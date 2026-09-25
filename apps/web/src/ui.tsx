import type { ComponentChildren } from 'preact';
import { formatMoney } from '@sea-trader/shared';
import { toasts } from './toast';

export function Win(props: {
  title: ComponentChildren;
  right?: ComponentChildren;
  dark?: boolean;
  class?: string;
  children: ComponentChildren;
  bodyClass?: string;
}) {
  return (
    <section class={`win ${props.dark ? 'dark' : ''} ${props.class ?? ''}`}>
      <div class="title">
        <span class="grow">{props.title}</span>
        {props.right}
      </div>
      <div class={`body ${props.bodyClass ?? ''}`}>{props.children}</div>
    </section>
  );
}

export function Bar({
  value,
  max = 100,
  warn = 50,
  low = 25,
}: {
  value: number;
  max?: number;
  warn?: number;
  low?: number;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div class={`bar ${pct < low ? 'low' : pct < warn ? 'warn' : ''}`} title={`${Math.round(pct)}%`}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Money({ v, signed }: { v: number; signed?: boolean }) {
  return (
    <span class={`nowrap ${signed ? (v >= 0 ? 'good' : 'bad') : v < 0 ? 'bad' : ''}`}>{formatMoney(v)}</span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: ComponentChildren;
  onClose?: () => void;
  children: ComponentChildren;
  wide?: boolean;
}) {
  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <Win
        title={title}
        right={
          onClose && (
            <button class="small" onClick={onClose}>
              X
            </button>
          )
        }
        class={wide ? '' : ''}
      >
        {children}
      </Win>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: [T, string][];
  value: T;
  onChange: (t: T) => void;
}) {
  return (
    <div class="tabs">
      {tabs.map(([id, label]) => (
        <button key={id} class={id === value ? 'active' : ''} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function colorHex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

export function Swatch({ color }: { color: number }) {
  return <span class="swatch" style={{ background: colorHex(color) }} />;
}

export function Loading({ text = 'Loading' }: { text?: string }) {
  return (
    <div class="page center">
      <p class="spinner">{text}</p>
    </div>
  );
}
