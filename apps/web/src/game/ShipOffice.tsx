import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  CARGO_LABEL,
  PORTS,
  portLocalTime,
  canalFee,
  findRoute,
  formatMoney,
  fuelNeeded,
  fuelPrice,
  getPort,
  getShipClass,
  maxSpeed,
  minSpeed,
  portFee,
  REPAIR_POINTS_PER_DAY,
  repairCostPerPoint,
  routeOptsFor,
  shipAgeYears,
  shipValue,
  voyageDays,
  type CharterOffer,
  type Ship,
} from '@sea-trader/shared';
import { cmd, liveDay, offers, priv, requestOffers } from '../net';
import { toast } from '../toast';
import { Bar, Money, Tabs, Win } from '../ui';
import { HarborGame } from '../minigames/HarborGame';
import { ReefGame } from '../minigames/ReefGame';
import { gameDateStr, gameTs, realDuration, STATUS_LABEL, useTicker } from './util';

type Tab = 'charter' | 'sail' | 'bunker' | 'dock' | 'sell';

async function run(c: Parameters<typeof cmd>[0], ok?: string): Promise<boolean> {
  const r = await cmd(c);
  if (r.ok) {
    if (ok || r.message) toast(ok ?? r.message ?? 'Done', 'ok');
    return true;
  }
  toast(r.error, 'err');
  return false;
}

export function ShipOffice({ ship }: { ship: Ship }) {
  useTicker(1000);
  const p = priv.value!;
  const cls = getShipClass(ship.classId);
  const day = liveDay();
  const port = getPort(ship.port);
  const [tab, setTab] = useState<Tab>('charter');
  const [speed, setSpeed] = useState(() => Math.min(maxSpeed(ship), cls.speed));
  useEffect(
    () => setSpeed((s) => Math.max(minSpeed(ship), Math.min(maxSpeed(ship), s))),
    [ship.id, ship.condition],
  );
  const inPort = ship.status === 'in_port';
  const canBunker = ['in_port', 'loading', 'unloading', 'repairing'].includes(ship.status);

  let where = '';
  if (ship.voyage && (ship.status === 'at_sea' || ship.status === 'awaiting_pilot')) {
    const v = ship.voyage;
    const left = Math.max(0, v.distance - v.progressNm);
    const eta = day + Math.max(0, v.holdUntil - day) + left / (v.speed * 24);
    where = `${getPort(v.from).name} → ${port.name} · ${Math.round(v.progressNm)}/${v.distance} nm · ETA ${gameDateStr(eta, true)} (${realDuration(eta - day)})`;
  } else where = `${port.name} · local time ${portLocalTime(port.tz, gameTs(day))}`;

  return (
    <Win title={`${ship.name}`} right={<span class="small-text">{cls.name}</span>}>
      <div class="kv small-text" style={{ marginBottom: '8px' }}>
        <span>Status</span>
        <span>
          <b>{STATUS_LABEL[ship.status]}</b>
          {['loading', 'unloading', 'docking', 'repairing'].includes(ship.status) &&
            ` · done in ${realDuration(ship.statusUntil - day)}`}
        </span>
        <span>Where</span>
        <span>{where}</span>
        <span>Condition</span>
        <span class="row">
          <span class="grow">
            <Bar value={ship.condition} warn={70} low={45} />
          </span>
          {Math.round(ship.condition)}%
        </span>
        <span>Fuel</span>
        <span class="row">
          <span class="grow">
            <Bar value={ship.fuel} max={cls.tank} warn={40} low={20} />
          </span>
          {Math.floor(ship.fuel)}/{cls.tank} t
        </span>
        <span>Specs</span>
        <span>
          {cls.capacity.toLocaleString('en')} t {CARGO_LABEL[cls.cargo].toLowerCase()} · {cls.speed} kn ·{' '}
          {cls.fuelPerDay} t/day · built {Math.round(shipAgeYears(ship, day))} yrs ago
        </span>
        {ship.cargo && (
          <>
            <span>Cargo</span>
            <span>
              {ship.cargo.tons.toLocaleString('en')} t {CARGO_LABEL[ship.cargo.type].toLowerCase()} →{' '}
              {getPort(ship.cargo.to).name}, <Money v={ship.cargo.pay} /> due {gameDateStr(ship.cargo.dueDay)}
              {day > ship.cargo.dueDay && <b class="bad"> LATE</b>}
            </span>
          </>
        )}
      </div>

      {ship.pending && <Decision ship={ship} />}

      {(inPort || canBunker) && !ship.pending && (
        <>
          <Tabs<Tab>
            tabs={
              inPort
                ? [
                    ['charter', 'Charter'],
                    ['sail', 'Sail'],
                    ['bunker', 'Bunker'],
                    ['dock', 'Drydock'],
                    ['sell', 'Sell'],
                  ]
                : [['bunker', 'Bunker']]
            }
            value={inPort ? tab : 'bunker'}
            onChange={setTab}
          />
          {inPort && (tab === 'charter' || tab === 'sail') && (
            <label style={{ marginBottom: '8px' }}>
              <span>
                Speed: <b>{speed.toFixed(1)} kn</b> · fuel{' '}
                {(cls.fuelPerDay * (speed / cls.speed) ** 3).toFixed(1)} t/day
              </span>
              <input
                type="range"
                min={minSpeed(ship)}
                max={maxSpeed(ship)}
                step={0.1}
                value={speed}
                onInput={(e) => setSpeed(Number(e.currentTarget.value))}
              />
            </label>
          )}
          {inPort && tab === 'charter' && <Charter ship={ship} speed={speed} />}
          {inPort && tab === 'sail' && <Sail ship={ship} speed={speed} />}
          {(tab === 'bunker' || !inPort) && <Bunker ship={ship} />}
          {inPort && tab === 'dock' && <Drydock ship={ship} />}
          {inPort && tab === 'sell' && <Sell ship={ship} />}
        </>
      )}
      <div class="row" style={{ marginTop: '10px' }}>
        <button
          class="small"
          onClick={() => {
            const n = prompt('New name for the ship', ship.name);
            if (n) void run({ type: 'renameShip', shipId: ship.id, name: n });
          }}
        >
          Rename
        </button>
        <span class="small-text muted right">
          Cash: <Money v={p.me!.player.cash} />
        </span>
      </div>
    </Win>
  );
}

function Decision({ ship }: { ship: Ship }) {
  const d = ship.pending!;
  const [game, setGame] = useState<null | 'harbor' | 'reef'>(null);
  const left = d.deadlineDay - liveDay();
  const choose = (choice: string, inputs?: number[]) =>
    run({ type: 'decide', shipId: ship.id, choice, inputs }, 'Orders sent — see the log');
  return (
    <div class="decision">
      {d.kind === 'pilot' && (
        <>
          <p style={{ margin: '0 0 6px' }}>
            <b>{ship.name}</b> is waiting off {getPort(ship.port).name}. Take the helm yourself and save the
            tug fee, or hire tugs for <Money v={d.tugFee ?? 0} />?
          </p>
          <div class="row">
            <button
              class="primary"
              onClick={() => {
                void cmd({ type: 'decide', shipId: ship.id, choice: 'playing' });
                setGame('harbor');
              }}
            >
              Steer her in
            </button>
            <button onClick={() => choose('tug')}>Hire tugs</button>
          </div>
        </>
      )}
      {d.kind === 'pirates' && (
        <>
          <p style={{ margin: '0 0 6px' }}>
            ☠ Pirates approach <b>{ship.name}</b>! They demand <Money v={d.ransom ?? 0} />. Running is risky —
            faster ships escape more often.
          </p>
          <div class="row">
            <button onClick={() => choose('pay')}>Pay ransom</button>
            <button class="danger" onClick={() => choose('run')}>
              Full speed — run!
            </button>
          </div>
        </>
      )}
      {d.kind === 'hazard' && (
        <>
          <p style={{ margin: '0 0 6px' }}>
            <b>{ship.name}</b> approaches {d.place}. Navigate the passage yourself or detour (+{d.detourDays}{' '}
            days)?
          </p>
          <div class="row">
            <button
              class="primary"
              onClick={() => {
                void cmd({ type: 'decide', shipId: ship.id, choice: 'playing' });
                setGame('reef');
              }}
            >
              Navigate
            </button>
            <button onClick={() => choose('detour')}>Detour</button>
          </div>
        </>
      )}
      {d.kind === 'weather' && (
        <>
          <p style={{ margin: '0 0 6px' }}>
            🌀 <b>{ship.name}</b> is heading into <b>{d.stormName}</b>
            {d.severity === 'red' ? ', a very dangerous storm' : ', a severe storm'}. Sail straight through
            (damage and some delay) or go around (+{d.detourDays} days)?
          </p>
          <div class="row">
            <button class="danger" onClick={() => choose('through')}>
              Sail through
            </button>
            <button class="primary" onClick={() => choose('around')}>
              Go around
            </button>
          </div>
        </>
      )}
      {d.kind === 'conflict' && (
        <>
          <p style={{ margin: '0 0 6px' }}>
            ⚠ <b>{ship.name}</b> is approaching <b>{d.place}</b>,{' '}
            {d.level === 'war'
              ? 'a war zone'
              : d.level === 'high'
                ? 'a high-risk area'
                : 'an elevated-risk area'}
            . Pay <b>{formatMoney(d.premium ?? 0)}</b> war-risk cover and sail through (risk of attack), or
            avoid it by rerouting or waiting for an escort (+{d.detourDays} days)?
          </p>
          <div class="row">
            <button class="danger" onClick={() => choose('through')}>
              Sail through
            </button>
            <button class="primary" onClick={() => choose('avoid')}>
              Avoid
            </button>
          </div>
        </>
      )}
      {d.kind === 'distress' && (
        <>
          <p style={{ margin: '0 0 6px' }}>
            📻 Mayday! A vessel near <b>{ship.name}</b> is sinking. Divert to rescue (+1 day)? Salvage rewards
            are paid.
          </p>
          <div class="row">
            <button class="primary" onClick={() => choose('rescue')}>
              Rescue
            </button>
            <button onClick={() => choose('ignore')}>Hold course</button>
          </div>
        </>
      )}
      <p class="small-text muted" style={{ margin: '6px 0 0' }}>
        If you don't decide within {realDuration(left)} the captain will choose the safe option.
      </p>
      {game === 'harbor' && (
        <HarborGame
          seed={d.seed}
          title={`Docking ${ship.name} — ${getPort(ship.port).name}`}
          onDone={(inputs) => {
            setGame(null);
            if (inputs) void choose('steer', inputs);
          }}
        />
      )}
      {game === 'reef' && (
        <ReefGame
          seed={d.seed}
          title={`${ship.name} — ${d.place}`}
          onDone={(inputs) => {
            setGame(null);
            if (inputs) void choose('navigate', inputs);
          }}
        />
      )}
    </div>
  );
}

function estimate(ship: Ship, to: string, speed: number, pay: number) {
  const p = priv.value!;
  const cls = getShipClass(ship.classId);
  const from = getPort(ship.port);
  const route = findRoute(from, getPort(to), routeOptsFor(cls));
  const days = voyageDays(route.distance, speed);
  const need = fuelNeeded(cls, route.distance, speed);
  const burn = need / 1.1;
  const fuelCost = burn * fuelPrice(from, p.market);
  const canals = route.canals.reduce((a, c) => a + canalFee(c, cls), 0);
  const cost = fuelCost + cls.opex * days + portFee(getPort(to), cls) + canals;
  return { route, days, need, cost, profit: pay - cost };
}

function Charter({ ship, speed }: { ship: Ship; speed: number }) {
  const cls = getShipClass(ship.classId);
  const entry = offers.value[ship.port];
  const day = liveDay();
  useEffect(() => {
    if (!entry || Math.floor(entry.day / 3) !== Math.floor(day / 3) || Date.now() - entry.at > 60000)
      requestOffers(ship.port);
  }, [ship.port, Math.floor(day / 3)]);
  const [sort, setSort] = useState<'profit' | 'pay'>('profit');
  const [all, setAll] = useState(false);
  const rows = useMemo(() => {
    if (!entry) return [];
    return entry.offers
      .map((o) => {
        const fits = o.type === cls.cargo && o.tons <= cls.capacity;
        const reason =
          o.type !== cls.cargo
            ? `needs ${CARGO_LABEL[o.type].toLowerCase()} ship`
            : o.tons > cls.capacity
              ? 'too large'
              : '';
        return { o, fits, reason, est: estimate(ship, o.to, speed, o.pay) };
      })
      .filter((r) => all || r.fits)
      .sort(
        (a, b) =>
          Number(b.fits) - Number(a.fits) ||
          (sort === 'profit' ? b.est.profit - a.est.profit : b.o.pay - a.o.pay),
      );
  }, [entry, speed, sort, ship.id, all]);

  async function accept(o: CharterOffer) {
    const ok = await run({ type: 'charter', shipId: ship.id, offerId: o.offerId, speed });
    if (ok) {
      toast(`${ship.name} is loading for ${getPort(o.to).name}`, 'ok');
      requestOffers(ship.port);
    }
  }

  if (!entry) return <p class="spinner">Asking the shipbrokers</p>;
  return (
    <div>
      <div class="row small-text" style={{ marginBottom: '4px' }}>
        <span class="grow muted">Offers in {getPort(ship.port).name} (new list every 3 days)</span>
        <label class="row" style={{ gap: '4px' }}>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.currentTarget.checked)} /> all
        </label>
        <select value={sort} onChange={(e) => setSort(e.currentTarget.value as 'profit' | 'pay')}>
          <option value="profit">Best est. profit</option>
          <option value="pay">Highest pay</option>
        </select>
      </div>
      <div class="list">
        <table class="small-text">
          <thead>
            <tr>
              <th>Cargo → port</th>
              <th class="num">Pay</th>
              <th class="num">Est.</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ o, fits, reason, est }) => (
              <tr key={o.offerId} style={{ opacity: fits ? 1 : 0.5 }}>
                <td>
                  {o.tons.toLocaleString('en')} t {CARGO_LABEL[o.type].toLowerCase()} →{' '}
                  <b>{getPort(o.to).name}</b>
                  <div class="muted">
                    {est.route.distance} nm · {est.days.toFixed(1)} d · due {gameDateStr(o.dueDay)} · fuel{' '}
                    {est.need} t{est.route.canals.length ? ` · ${est.route.canals.join('+')}` : ''}
                  </div>
                </td>
                <td class="num">
                  <Money v={o.pay} />
                </td>
                <td class="num">
                  {fits ? <Money v={est.profit} signed /> : <span class="muted">{reason}</span>}
                </td>
                <td class="num">
                  <button
                    class="small"
                    disabled={!fits || ship.fuel < est.need}
                    title={ship.fuel < est.need ? 'Not enough fuel — bunker first' : ''}
                    onClick={() => accept(o)}
                  >
                    {ship.fuel < est.need && fits ? 'Fuel!' : 'Take'}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} class="muted">
                  No suitable cargo on offer. Sail elsewhere or wait for the next list.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Sail({ ship, speed }: { ship: Ship; speed: number }) {
  const cls = getShipClass(ship.classId);
  const here = getPort(ship.port);
  const [to, setTo] = useState(PORTS.find((x) => x.id !== ship.port)!.id);
  const est = estimate(ship, to, speed, 0);
  return (
    <div class="col">
      <p class="small-text muted" style={{ margin: 0 }}>
        Sail in ballast (empty) to reposition, e.g. to a port with better cargo for a {cls.name}.
      </p>
      <select value={to} onChange={(e) => setTo(e.currentTarget.value)}>
        {PORTS.filter((x) => x.id !== ship.port)
          .map((x) => ({ x, d: findRoute(here, x, routeOptsFor(cls)).distance }))
          .sort((a, b) => a.d - b.d)
          .map(({ x, d }) => (
            <option key={x.id} value={x.id}>
              {x.name} ({d} nm, exports {x.exports[cls.cargo]}/6)
            </option>
          ))}
      </select>
      <div class="small-text">
        {est.route.distance} nm · {est.days.toFixed(1)} days (~{realDuration(est.days)} real) · needs{' '}
        {est.need} t fuel · cost ≈ {formatMoney(est.cost)}
      </div>
      <button
        class="primary"
        disabled={ship.fuel < est.need}
        onClick={() => run({ type: 'sail', shipId: ship.id, to, speed }, `${ship.name} set sail`)}
      >
        {ship.fuel < est.need ? 'Not enough fuel' : 'Cast off'}
      </button>
    </div>
  );
}

function Bunker({ ship }: { ship: Ship }) {
  const p = priv.value!;
  const cls = getShipClass(ship.classId);
  const price = fuelPrice(getPort(ship.port), p.market);
  const room = Math.floor(cls.tank - ship.fuel);
  const [tons, setTons] = useState(room);
  useEffect(() => setTons(room), [ship.id, room]);
  return (
    <div class="col">
      <div class="small-text">
        Bunker price in {getPort(ship.port).name}: <b>${price}/t</b> (world index{' '}
        {p.market.fuelIndex.toFixed(2)})
      </div>
      <input
        type="range"
        min={0}
        max={room}
        value={tons}
        onInput={(e) => setTons(Number(e.currentTarget.value))}
        disabled={room <= 0}
      />
      <div class="row">
        <span class="grow">
          {tons} t = <Money v={tons * price} />
        </span>
        <button
          class="primary"
          disabled={tons <= 0}
          onClick={() => run({ type: 'refuel', shipId: ship.id, tons })}
        >
          {room <= 0 ? 'Tanks full' : 'Bunker'}
        </button>
      </div>
    </div>
  );
}

function Drydock({ ship }: { ship: Ship }) {
  const cls = getShipClass(ship.classId);
  const [target, setTarget] = useState(100);
  const pts = Math.max(0, target - ship.condition);
  return (
    <div class="col">
      <div class="small-text">
        Repairs cost {formatMoney(repairCostPerPoint(cls))} per % and take a day per {REPAIR_POINTS_PER_DAY}%.
      </div>
      <label>
        <span>Repair to {target}%</span>
        <input
          type="range"
          min={Math.ceil(ship.condition)}
          max={100}
          value={target}
          onInput={(e) => setTarget(Number(e.currentTarget.value))}
        />
      </label>
      <div class="row">
        <span class="grow">
          <Money v={pts * repairCostPerPoint(cls)} /> · {(pts / REPAIR_POINTS_PER_DAY).toFixed(1)} days
        </span>
        <button
          class="primary"
          disabled={pts <= 0}
          onClick={() => run({ type: 'repair', shipId: ship.id, target }, 'Into the drydock')}
        >
          Repair
        </button>
      </div>
    </div>
  );
}

function Sell({ ship }: { ship: Ship }) {
  const p = priv.value!;
  const value = Math.round(shipValue(ship, p.market, liveDay()) * 0.95);
  return (
    <div class="row">
      <span class="grow">
        A broker offers <Money v={value} /> for {ship.name}.
      </span>
      <button
        class="danger"
        onClick={() =>
          confirm(`Sell ${ship.name} for ${formatMoney(value)}?`) &&
          run({ type: 'sellShip', shipId: ship.id }, 'Sold')
        }
      >
        Sell ship
      </button>
    </div>
  );
}
