import { getPort, getShipClass } from '@sea-trader/shared';
import { priv } from '../net';
import { Bar, Win } from '../ui';
import { STATUS_LABEL } from './util';

export function Fleet({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const me = priv.value?.me;
  if (!me) return null;
  const pending = new Map(me.pending.map((p) => [p.shipId, p]));
  const ships = [...me.ships].sort(
    (a, b) => Number(pending.has(b.id)) - Number(pending.has(a.id)) || a.name.localeCompare(b.name),
  );
  return (
    <Win
      title={`Fleet (${ships.length})`}
      right={
        me.pending.length > 0 && (
          <span class={`badge ${me.pending.some((p) => p.kind !== 'orders') ? '' : 'calm'}`}>
            {me.pending.length}
          </span>
        )
      }
    >
      {ships.length === 0 && (
        <p style={{ margin: 0 }}>You have no ships yet. Buy your first vessel in the Shipyard below.</p>
      )}
      <div class="list">
        <table class="small-text">
          <tbody>
            {ships.map((s) => {
              const p = pending.get(s.id);
              return (
                <tr
                  key={s.id}
                  class={`clickable ${selected === s.id ? 'selected' : ''}`}
                  onClick={() => onSelect(s.id)}
                >
                  <td>
                    <b>{s.name}</b>{' '}
                    {p && (
                      <span class={`badge ${p.kind === 'orders' ? 'calm' : ''}`}>
                        {p.kind === 'orders' ? 'ORDERS' : '!'}
                      </span>
                    )}
                    <div class="muted">
                      {getShipClass(s.classId).name} · {STATUS_LABEL[s.status]} ·{' '}
                      {s.voyage ? `→ ${getPort(s.voyage.to).name}` : getPort(s.port).name}
                    </div>
                  </td>
                  <td style={{ width: '70px' }}>
                    <Bar value={s.condition} warn={70} low={45} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Win>
  );
}
