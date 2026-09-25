import { useState } from 'preact/hooks';
import {
  CARGO_LABEL,
  PLAYER_COLORS,
  PORTS,
  SHIP_CLASSES,
  formatMoney,
  getPort,
  getShipClass,
  newShipPrice,
  shipAgeYears,
} from '@sea-trader/shared';
import { cmd, liveDay, priv, pub } from '../net';
import { toast } from '../toast';
import { Money, Swatch, Tabs, Win, colorHex } from '../ui';
import { gameDateStr } from './util';

type Tab = 'yard' | 'bank' | 'ranks' | 'company';

async function run(c: Parameters<typeof cmd>[0], ok: string) {
  const r = await cmd(c);
  toast(r.ok ? ok : r.error, r.ok ? 'ok' : 'err');
  return r.ok;
}

export function CompanyPanel({ initial = 'yard' }: { initial?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial);
  const me = priv.value?.me;
  return (
    <Win title={me ? me.player.company : 'Company'}>
      <Tabs<Tab>
        tabs={[
          ['yard', 'Shipyard'],
          ['bank', 'Bank'],
          ['ranks', 'Rankings'],
          ['company', 'Company'],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'yard' && <Shipyard />}
      {tab === 'bank' && <Bank />}
      {tab === 'ranks' && <Rankings />}
      {tab === 'company' && <CompanyEdit />}
    </Win>
  );
}

function Shipyard() {
  const p = priv.value!;
  const cash = p.me!.player.cash;
  const [port, setPort] = useState(p.me!.ships[0]?.port ?? 'rtm');
  const [mode, setMode] = useState<'new' | 'used'>('new');
  const buy = (classId: string) => {
    const cls = getShipClass(classId);
    const name = prompt(`Name your new ${cls.name}`, '');
    if (name === null) return;
    void run({ type: 'buyShip', classId, port, name }, `${cls.name} delivered in ${getPort(port).name}`);
  };
  const buyUsed = (id: string, classId: string) => {
    const name = prompt(`Name your ${getShipClass(classId).name}`, '');
    if (name === null) return;
    void run({ type: 'buyUsed', listingId: id, name }, 'Ship purchased');
  };
  return (
    <div>
      <div class="row" style={{ marginBottom: '8px' }}>
        <button class={`small ${mode === 'new' ? 'primary' : ''}`} onClick={() => setMode('new')}>
          New builds
        </button>
        <button class={`small ${mode === 'used' ? 'primary' : ''}`} onClick={() => setMode('used')}>
          Second-hand ({p.usedShips.length})
        </button>
        {mode === 'new' && (
          <label class="row right">
            Deliver to
            <select value={port} onChange={(e) => setPort(e.currentTarget.value)}>
              {[...PORTS]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      <div class="list">
        {mode === 'new' ? (
          <table class="small-text">
            <thead>
              <tr>
                <th>Type</th>
                <th class="num">Capacity</th>
                <th class="num">Speed</th>
                <th class="num">Price</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {SHIP_CLASSES.map((c) => {
                const price = newShipPrice(c.id, p.market);
                return (
                  <tr key={c.id}>
                    <td>
                      <b>{c.name}</b>
                      <div class="muted">
                        {CARGO_LABEL[c.cargo]} · {c.fuelPerDay} t/day · opex {formatMoney(c.opex)}/day
                        {c.noPanama ? ' · no Panama' : ''}
                        {c.noSuez ? ' · no Suez' : ''}
                      </div>
                    </td>
                    <td class="num">{c.capacity.toLocaleString('en')} t</td>
                    <td class="num">{c.speed} kn</td>
                    <td class="num">
                      <Money v={price} />
                    </td>
                    <td class="num">
                      <button class="small" disabled={cash < price} onClick={() => buy(c.id)}>
                        Buy
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table class="small-text">
            <thead>
              <tr>
                <th>Ship</th>
                <th>Where</th>
                <th class="num">Price</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {p.usedShips.map((l) => {
                const c = getShipClass(l.classId);
                return (
                  <tr key={l.id}>
                    <td>
                      <b>{c.name}</b>
                      <div class="muted">
                        {Math.round(shipAgeYears(l, liveDay()))} yrs · {l.condition}% ·{' '}
                        {c.capacity.toLocaleString('en')} t
                      </div>
                    </td>
                    <td>{getPort(l.port).name}</td>
                    <td class="num">
                      <Money v={l.price} />
                    </td>
                    <td class="num">
                      <button
                        class="small"
                        disabled={cash < l.price}
                        onClick={() => buyUsed(l.id, l.classId)}
                      >
                        Buy
                      </button>
                    </td>
                  </tr>
                );
              })}
              {p.usedShips.length === 0 && (
                <tr>
                  <td colSpan={4} class="muted">
                    Nothing for sale. The list refreshes monthly.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Bank() {
  const p = priv.value!;
  const me = p.me!;
  const [amount, setAmount] = useState(1_000_000);
  const room = Math.max(0, me.loanLimit - me.player.loan);
  return (
    <div class="col">
      <div class="kv">
        <span>Cash</span>
        <Money v={me.player.cash} />
        <span>Fleet value</span>
        <Money v={me.fleetValue} />
        <span>Loan</span>
        <Money v={-me.player.loan} />
        <span>Credit line</span>
        <span>
          <Money v={me.loanLimit} /> ({formatMoney(room)} available)
        </span>
        <span>Interest</span>
        <span>{(p.settings.interestRate * 100).toFixed(1)}% p.a., charged daily. Overdrafts cost 18%.</span>
        <span>Net worth</span>
        <Money v={me.netWorth} signed />
        <span>Revenue</span>
        <Money v={me.player.stats.revenue} />
        <span>Voyages</span>
        <span>{me.player.stats.voyages}</span>
      </div>
      <div class="row">
        <input
          type="number"
          min={0}
          step={100000}
          value={amount}
          onInput={(e) => setAmount(Number(e.currentTarget.value))}
          style={{ width: '160px' }}
        />
        <button
          onClick={() => run({ type: 'borrow', amount }, `Borrowed ${formatMoney(amount)}`)}
          disabled={amount <= 0 || amount > room}
        >
          Borrow
        </button>
        <button onClick={() => run({ type: 'repay', amount }, 'Repaid')} disabled={me.player.loan <= 0}>
          Repay
        </button>
      </div>
    </div>
  );
}

function Rankings() {
  const s = pub.value!;
  const rows = Object.values(s.players).sort((a, b) => b.netWorth - a.netWorth);
  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Company</th>
          <th class="num">Ships</th>
          <th class="num">Net worth</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id}>
            <td>{i + 1}</td>
            <td>
              <Swatch color={r.color} /> {r.company}
              <div class="small-text muted">
                {r.name}
                {r.online > 0 ? ' · online' : ''}
                {r.bankrupt ? ' · BANKRUPT' : ''}
                {s.winner === r.id ? ' · WINNER' : ''}
              </div>
            </td>
            <td class="num">{r.ships}</td>
            <td class="num">
              <Money v={r.netWorth} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CompanyEdit() {
  const me = priv.value!.me!;
  const [name, setName] = useState(me.player.company);
  const [color, setColor] = useState(me.player.color);
  const s = pub.value!;
  const taken = new Set(
    Object.values(s.players)
      .filter((p) => p.id !== me.player.id)
      .map((p) => p.color),
  );
  return (
    <div class="col">
      <label>
        <span>Company name</span>
        <input value={name} maxLength={24} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <div class="row">
        {PLAYER_COLORS.map((c) => (
          <button
            key={c}
            class="small"
            disabled={taken.has(c)}
            aria-label={colorHex(c)}
            style={{
              background: colorHex(c),
              width: '32px',
              height: '28px',
              outline: c === color ? '3px solid #fff' : 'none',
            }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <button
        class="primary"
        onClick={() => run({ type: 'setCompany', company: name, color }, 'Company updated')}
      >
        Save
      </button>
      <p class="small-text muted">
        Game started {gameDateStr(0, true)}.{' '}
        {s.durationDays > 0 ? `Ends ${gameDateStr(s.durationDays)}.` : 'Endless game.'} Time runs at{' '}
        {s.timeScale}× real time.
      </p>
    </div>
  );
}
