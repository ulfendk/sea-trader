import { useEffect, useState } from 'preact/hooks';
import { formatMoney, getPort } from '@sea-trader/shared';
import { me } from '../api';
import { connection, connectGame, connError, leaveGame, liveDay, priv, pub } from '../net';
import { navigate, query } from '../router';
import { Loading, Win } from '../ui';
import { CompanyPanel } from '../game/Company';
import { Fleet } from '../game/Fleet';
import { LogPanel } from '../game/Log';
import { ShipOffice } from '../game/ShipOffice';
import { gameDateStr, localZoneName, useTicker } from '../game/util';
import { WorldMap } from '../game/WorldMap';
import { ModernMap } from '../game/ModernMap';
import { mapStyle, setMapStyle } from '../prefs';
import { toast } from '../toast';

export function Game({ id }: { id: string }) {
  useTicker(1000);
  const [selected, setSelected] = useState<string | null>(query.value.get('ship'));
  const [tab, setTab] = useState<'map' | 'ships' | 'company'>('map');
  // Modern map failed to load this session (offline or blocked): fall back without changing the saved choice.
  const [modernFailed, setModernFailed] = useState(false);
  const showModern = mapStyle.value === 'modern' && !modernFailed;

  useEffect(() => {
    void connectGame(id);
    return () => void leaveGame();
  }, [id]);

  const p = pub.value;
  const pv = priv.value;
  const myId = me.value!.user.id;

  // Auto-select a ship needing attention when nothing is selected.
  useEffect(() => {
    if (!pv?.me) return;
    if (selected && pv.me.ships.some((s) => s.id === selected)) return;
    const first = pv.me.pending[0]?.shipId ?? pv.me.ships[0]?.id ?? null;
    setSelected(first);
  }, [pv?.me?.ships.length, pv?.me?.pending.length]);

  useEffect(() => {
    const n = pv?.me?.pending.length ?? 0;
    document.title = n ? `(${n}) Sea Trader` : 'Sea Trader';
    return () => void (document.title = 'Sea Trader');
  }, [pv?.me?.pending.length]);

  if (connection.value === 'error')
    return (
      <div class="page">
        <Win title="Cannot join game">
          <p>{connError.value}</p>
          <button onClick={() => navigate('/')}>Back to lobby</button>
        </Win>
      </div>
    );
  if (!p || !pv) return <Loading text="Hoisting the sails" />;

  const myShip = pv.me?.ships.find((s) => s.id === selected) ?? null;
  const otherShip = !myShip && selected ? p.ships[selected] : null;
  const pendingPorts = (pv.me?.pending ?? [])
    .map((a) => pv.me!.ships.find((s) => s.id === a.shipId)?.port)
    .filter(Boolean) as string[];
  const select = (sid: string) => {
    setSelected(sid);
    if (window.innerWidth <= 900 && pv.me?.ships.some((s) => s.id === sid)) setTab('ships');
  };

  return (
    <>
      <div class="topbar gamebar">
        <b style={{ fontFamily: 'var(--font-head)', fontSize: '10px' }}>{p.name}</b>
        <span class="stat">
          <b>DATE</b>
          {gameDateStr(liveDay(), true)} <span class="muted">{localZoneName()}</span>
        </span>
        {pv.me && (
          <>
            <span class="stat">
              <b>CASH</b>
              <span class={pv.me.player.cash < 0 ? 'bad' : ''}>{formatMoney(pv.me.player.cash)}</span>
            </span>
            <span class="stat hide-sm">
              <b>WORTH</b>
              {formatMoney(pv.me.netWorth)}
            </span>
          </>
        )}
        <span
          class="stat hide-sm"
          title={
            p.realFuel && p.brent
              ? `Bunker prices follow Brent crude: $${p.brent.toFixed(2)}/bbl on ${p.brentDate}`
              : 'Simulated fuel market'
          }
        >
          <b>FUEL IDX</b>
          {p.fuelIndex.toFixed(2)}
          {p.realFuel && p.brent ? <span class="muted"> (Brent ${p.brent.toFixed(0)})</span> : null}
        </span>
        {p.status !== 'running' && (
          <span class="badge calm">{p.status === 'lobby' ? 'NOT STARTED' : p.status.toUpperCase()}</span>
        )}
        {connection.value !== 'online' && <span class="badge">OFFLINE</span>}
      </div>
      {!pv.me && (
        <div class="page">
          <Win title="Spectating">You are an admin viewing this game but not a player.</Win>
        </div>
      )}
      <div class="game-layout" data-tab={tab}>
        <Win
          title="World"
          class="map-win"
          bodyClass=""
          right={
            <span class="row" style={{ gap: '6px' }}>
              <span class="small-text">{p.timeScale === 1 ? 'real time' : `${p.timeScale}× speed`}</span>
              <button
                class="small"
                title="Switch between the pixel map and the modern map"
                onClick={() => {
                  setModernFailed(false);
                  setMapStyle(mapStyle.value === 'modern' ? 'pixel' : 'modern');
                }}
              >
                {showModern ? 'Pixel map' : 'Modern map'}
              </button>
            </span>
          }
        >
          <div style={{ margin: '-10px' }}>
            {showModern ? (
              <ModernMap
                myId={myId}
                selectedShip={selected}
                onSelectShip={select}
                highlightPorts={pendingPorts}
                onFail={(reason) => {
                  setModernFailed(true);
                  toast(`${reason} Showing the pixel map instead.`, 'err');
                }}
              />
            ) : (
              <WorldMap
                myId={myId}
                selectedShip={selected}
                onSelectShip={select}
                highlightPorts={pendingPorts}
              />
            )}
          </div>
          {otherShip && (
            <div class="small-text" style={{ marginTop: '14px' }}>
              <b>{otherShip.name}</b> — {p.players[otherShip.owner]?.company} ·{' '}
              {otherShip.status === 'at_sea'
                ? `bound for ${getPort(otherShip.to).name}`
                : `in ${getPort(otherShip.port).name}`}
            </div>
          )}
        </Win>
        <div class="side">
          {pv.me && <Fleet selected={selected} onSelect={setSelected} />}
          {myShip && <ShipOffice ship={myShip} />}
        </div>
        <div class="lower">
          {pv.me && <CompanyPanel initial={pv.me.ships.length ? 'ranks' : 'yard'} />}
          <LogPanel />
        </div>
      </div>
      <nav class="mobile-nav">
        <button class={tab === 'map' ? 'primary' : ''} onClick={() => setTab('map')}>
          Map
        </button>
        <button class={tab === 'ships' ? 'primary' : ''} onClick={() => setTab('ships')}>
          Ships{pv.me?.pending.length ? ` (${pv.me.pending.length})` : ''}
        </button>
        <button class={tab === 'company' ? 'primary' : ''} onClick={() => setTab('company')}>
          Company
        </button>
      </nav>
    </>
  );
}
