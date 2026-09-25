import { useEffect, useState } from 'preact/hooks';
import { api, me, refreshMe } from '../api';
import { navigate } from '../router';
import { toast } from '../toast';
import { Money, Win } from '../ui';

export function Lobby() {
  const data = me.value!;
  const [code, setCode] = useState('');

  useEffect(() => {
    const t = setInterval(() => void refreshMe().catch(() => undefined), 30000);
    return () => clearInterval(t);
  }, []);

  async function redeem(e: Event) {
    e.preventDefault();
    try {
      await api('POST', '/invites/redeem', { code });
      setCode('');
      toast('Welcome aboard!', 'ok');
      await refreshMe();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'err');
    }
  }

  return (
    <div class="page col" style={{ gap: '16px' }}>
      <Win title={`Welcome, ${data.user.displayName}`}>
        <p style={{ marginTop: 0 }}>
          Choose a game to manage your fleet. Ships sail in real time — check back when they need orders.
        </p>
        {data.games.length === 0 && (
          <p class="muted">You are not in any games yet. Ask the admin for an invite code.</p>
        )}
        <div class="cards">
          {data.games.map((g) => (
            <div
              key={g.id}
              class="win dark"
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/game/${g.id}`)}
            >
              <div class="title">
                <span class="grow">{g.name}</span>
                {g.pending.filter((p) => p.kind !== 'orders').length > 0 ? (
                  <span class="badge">!</span>
                ) : g.pending.length > 0 ? (
                  <span class="badge calm">{g.pending.length}</span>
                ) : null}
              </div>
              <div class="body kv">
                <span>Company</span>
                <span>{g.company || '—'}</span>
                <span>Date</span>
                <span>{g.date}</span>
                <span>Cash</span>
                <Money v={g.cash} />
                <span>Players</span>
                <span>{g.players}</span>
                <span>Status</span>
                <span>{g.status === 'lobby' ? 'Waiting to start' : g.status}</span>
                {g.pending.length > 0 && (
                  <>
                    <span>Orders</span>
                    <span class="good">{g.pending.map((p) => p.shipName).join(', ')}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Win>
      <Win title="Join another game">
        <form class="row" onSubmit={redeem}>
          <input
            value={code}
            onInput={(e) => setCode(e.currentTarget.value.toUpperCase())}
            placeholder="Invite code"
            required
          />
          <button type="submit">Join</button>
        </form>
      </Win>
    </div>
  );
}
