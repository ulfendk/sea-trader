import { useState } from 'preact/hooks';
import { priv, pub } from '../net';
import { Win } from '../ui';
import { gameDateStr } from './util';

export function LogPanel() {
  const [tab, setTab] = useState<'mine' | 'news'>('mine');
  const mine = [...(priv.value?.log ?? [])].reverse();
  const news = [...(pub.value?.news ?? [])].reverse();
  return (
    <Win
      title="Ship's log"
      dark
      right={
        <span class="row" style={{ gap: '4px' }}>
          <button class={`small ${tab === 'mine' ? 'primary' : ''}`} onClick={() => setTab('mine')}>
            Mine
          </button>
          <button class={`small ${tab === 'news' ? 'primary' : ''}`} onClick={() => setTab('news')}>
            News
          </button>
        </span>
      }
    >
      <div class="log">
        {(tab === 'mine' ? mine : news).map((l, i) => (
          <div key={i} class={l.kind === 'bad' ? 'bad' : l.kind === 'good' ? 'good' : ''}>
            <span class="muted">{gameDateStr(l.day)}</span> {l.text}
          </div>
        ))}
        {(tab === 'mine' ? mine : news).length === 0 && <div class="muted">Nothing yet.</div>}
      </div>
    </Win>
  );
}
