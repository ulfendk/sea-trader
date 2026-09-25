import { useEffect, useRef, useState } from 'preact/hooks';
import { priv, pub, type PubState } from '../net';
import { Win } from '../ui';
import { gameDateStr } from './util';

type Topic = 'all' | 'weather' | 'fuel' | 'conflict' | 'company';

const TOPICS: [Topic, string][] = [
  ['all', 'All'],
  ['weather', 'Weather'],
  ['fuel', 'Fuel'],
  ['conflict', 'Conflicts'],
  ['company', 'Companies'],
];
const ICON: Record<string, string> = {
  weather: '🌀',
  fuel: '⛽',
  conflict: '⚠',
  company: '🏢',
  game: '🏁',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Ship's log (my entries) and the public news, which can be opened in a large window. */
export function LogPanel() {
  const [tab, setTab] = useState<'mine' | 'news'>('mine');
  const [expanded, setExpanded] = useState(false);
  const newsCount = pub.value?.news.length ?? 0;
  const lastNews = pub.value?.news[newsCount - 1];
  // Unread news: items that arrived while the news was not on screen.
  const seen = useRef<string | null>(null);
  const [unread, setUnread] = useState(0);
  const showingNews = tab === 'news' || expanded;
  useEffect(() => {
    const key = lastNews ? `${lastNews.day}|${lastNews.text}` : '';
    if (seen.current === null || showingNews) {
      seen.current = key;
      setUnread(0);
    } else if (key !== seen.current) {
      const news = pub.value?.news ?? [];
      const idx = news.findIndex((n) => `${n.day}|${n.text}` === seen.current);
      setUnread(idx < 0 ? news.length : news.length - 1 - idx);
    }
  }, [lastNews?.day, lastNews?.text, showingNews]);

  const mine = [...(priv.value?.log ?? [])].reverse();
  return (
    <>
      <Win
        title="Ship's log"
        dark
        right={
          <span class="row" style={{ gap: '4px' }}>
            <button class={`small ${tab === 'mine' ? 'primary' : ''}`} onClick={() => setTab('mine')}>
              Mine
            </button>
            <button class={`small ${tab === 'news' ? 'primary' : ''}`} onClick={() => setTab('news')}>
              News{unread ? ` (${unread})` : ''}
            </button>
            <button class="small" title="Open the news in a large window" onClick={() => setExpanded(true)}>
              ⤢
            </button>
          </span>
        }
      >
        {tab === 'mine' ? (
          <div class="log">
            {mine.map((l, i) => (
              <div key={i} class={l.kind === 'bad' ? 'bad' : l.kind === 'good' ? 'good' : ''}>
                <span class="muted">{gameDateStr(l.day, true)}</span> {l.text}
              </div>
            ))}
            {mine.length === 0 && <div class="muted">Nothing yet.</div>}
          </div>
        ) : (
          <NewsFeed />
        )}
      </Win>
      {expanded && (
        <div class="modal-back" onClick={(e) => e.target === e.currentTarget && setExpanded(false)}>
          <Win
            title="World news"
            dark
            class="news-window"
            right={
              <button class="small" onClick={() => setExpanded(false)}>
                X
              </button>
            }
          >
            <Situation />
            <NewsFeed large />
          </Win>
        </div>
      )}
    </>
  );
}

function NewsFeed({ large }: { large?: boolean }) {
  const [topic, setTopic] = useState<Topic>('all');
  const news = [...(pub.value?.news ?? [])]
    .reverse()
    .filter((n) => topic === 'all' || n.topic === topic || (topic === 'company' && n.topic === 'game'));
  return (
    <div class="col" style={{ gap: '6px' }}>
      <div class="row news-topics" style={{ gap: '4px' }}>
        {TOPICS.map(([t, label]) => (
          <button key={t} class={`small ${t === topic ? 'primary' : ''}`} onClick={() => setTopic(t)}>
            {t !== 'all' && `${ICON[t]} `}
            {label}
          </button>
        ))}
      </div>
      <div class={`log ${large ? 'log-large' : ''}`}>
        {news.map((l, i) => (
          <div key={i} class={l.kind === 'bad' ? 'bad' : l.kind === 'good' ? 'good' : ''}>
            <span class="muted">{gameDateStr(l.day, true)}</span> {ICON[l.topic] ? `${ICON[l.topic]} ` : ''}
            {l.text}
          </div>
        ))}
        {news.length === 0 && <div class="muted">No news.</div>}
      </div>
    </div>
  );
}

/** Current real-world conditions affecting the game. */
function Situation() {
  const p = pub.value as PubState;
  const storms = p.storms ?? [];
  const zones = p.conflicts ?? [];
  const levelText = (l: string) => (l === 'war' ? 'war zone' : `${l} risk`);
  return (
    <div class="situation small-text">
      <div>
        <b>🌀 Storms</b>
        {!p.realWeather ? (
          <span class="muted">Real weather is off in this game.</span>
        ) : storms.length ? (
          storms.map((s) => (
            <span key={s.id} class={s.severity === 'red' ? 'bad' : ''}>
              {s.name} ({s.severity}
              {s.windKmh ? `, ${s.windKmh} km/h` : ''})
            </span>
          ))
        ) : (
          <span class="muted">No severe storms at sea.</span>
        )}
      </div>
      <div>
        <b>⚠ Conflict zones</b>
        {!p.realConflicts ? (
          <span class="muted">Conflict zones are off in this game.</span>
        ) : zones.length ? (
          zones.map((z) => (
            <span key={z.id} class={z.level === 'war' ? 'bad' : ''} title={z.note}>
              {cap(z.name)} ({levelText(z.level)}, avoid +{z.detourDays}d)
            </span>
          ))
        ) : (
          <span class="muted">None.</span>
        )}
      </div>
      <div>
        <b>⛽ Fuel</b>
        <span>
          Index {p.fuelIndex.toFixed(2)}
          {p.realFuel && p.brent
            ? ` · Brent $${p.brent.toFixed(2)}/bbl (${p.brentDate})`
            : p.realFuel
              ? ' · waiting for Brent prices'
              : ' · simulated market'}
        </span>
      </div>
    </div>
  );
}
