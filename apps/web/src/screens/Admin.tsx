import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_SETTINGS, formatMoney, type GameSettings } from '@sea-trader/shared';
import { api } from '../api';
import { toast } from '../toast';
import { Money, Tabs, Win } from '../ui';
import { errText, localDateTime } from '../game/util';

interface AdminGame {
  id: string;
  name: string;
  status: string;
  time: number;
  day: number;
  settings: GameSettings;
  live: boolean;
  clients: number;
  members: {
    id: string;
    name: string;
    company: string;
    cash: number;
    ships: number;
    pending: number;
    bankrupt: boolean;
  }[];
}
interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  disabled: boolean;
  lastSeenAt: string | null;
}
interface Invite {
  code: string;
  gameId: string | null;
  maxUses: number;
  uses: number;
  expiresAt: string | null;
}

const SETTING_FIELDS: [keyof GameSettings, string, string][] = [
  [
    'timeScale',
    'Time scale (game days per real day)',
    '1 = real time. Use e.g. 1440 (1 day/min) for testing.',
  ],
  ['startingCash', 'Starting cash ($)', ''],
  ['maxPlayers', 'Max players', ''],
  ['actionDeadlineHours', 'Decision deadline (game hours)', 'Default choice is applied after this.'],
  ['durationDays', 'Game length (game days, 0 = endless)', ''],
  ['eventRate', 'Random event rate (×)', ''],
  ['interestRate', 'Loan interest (0.08 = 8%)', ''],
];

export function Admin() {
  const [tab, setTab] = useState<'games' | 'users' | 'invites'>('games');
  const [games, setGames] = useState<AdminGame[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [overview, setOverview] = useState<{ uptime: number; users: number; rooms: unknown[] } | null>(null);

  const load = async () => {
    try {
      const [g, u, i, o] = await Promise.all([
        api<AdminGame[]>('GET', '/admin/games'),
        api<AdminUser[]>('GET', '/admin/users'),
        api<Invite[]>('GET', '/admin/invites'),
        api<{ uptime: number; users: number; rooms: unknown[] }>('GET', '/admin/overview'),
      ]);
      setGames(g);
      setUsers(u);
      setInvites(i);
      setOverview(o);
    } catch (e) {
      toast(errText(e), 'err');
    }
  };
  useEffect(() => {
    void load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const act = async (method: string, path: string, body?: unknown, ok = 'Done') => {
    try {
      const r = await api(method, path, body);
      toast(ok, 'ok');
      await load();
      return r;
    } catch (e) {
      toast(errText(e), 'err');
      return null;
    }
  };

  return (
    <div class="page col" style={{ gap: '16px', maxWidth: '1200px' }}>
      <Win
        title="Admin panel"
        right={
          overview && (
            <span class="small-text">
              up {Math.round(overview.uptime / 3600)}h · {overview.rooms.length} rooms · {overview.users}{' '}
              users
            </span>
          )
        }
      >
        <Tabs
          tabs={[
            ['games', 'Games'],
            ['users', 'Users'],
            ['invites', 'Invites'],
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === 'games' && <GamesTab games={games} users={users} act={act} />}
        {tab === 'users' && <UsersTab users={users} act={act} />}
        {tab === 'invites' && <InvitesTab invites={invites} games={games} act={act} />}
      </Win>
    </div>
  );
}

type Act = (method: string, path: string, body?: unknown, ok?: string) => Promise<unknown>;

function inviteLink(code: string) {
  return `${window.location.origin}${import.meta.env.BASE_URL}login?invite=${code}`;
}

function GamesTab({ games, users, act }: { games: AdminGame[]; users: AdminUser[]; act: Act }) {
  const [name, setName] = useState('');
  const [settings, setSettings] = useState<Partial<GameSettings>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<GameSettings>>({});
  const [joinSelf, setJoinSelf] = useState(true);

  const create = async (e: Event) => {
    e.preventDefault();
    const r = await act('POST', '/admin/games', { name, settings, joinSelf }, 'Game created');
    if (r) {
      setName('');
      setSettings({});
    }
  };

  const invite = async (gameId: string) => {
    const inv = (await act(
      'POST',
      '/admin/invites',
      { gameId, maxUses: 10, expiresDays: 30 },
      'Invite created',
    )) as Invite | null;
    if (inv) {
      const link = inviteLink(inv.code);
      await navigator.clipboard?.writeText(link).catch(() => undefined);
      prompt('Invite link (copied to clipboard):', link);
    }
  };

  return (
    <div class="col" style={{ gap: '14px' }}>
      {games.map((g) => (
        <div key={g.id} class="win dark">
          <div class="title">
            <span class="grow">
              {g.name} — {g.status.toUpperCase()}
            </span>
            <span class="small-text">
              {localDateTime(g.time)} · {g.clients} connected
            </span>
          </div>
          <div class="body col">
            <div class="row">
              {g.status !== 'running' && g.status !== 'finished' && (
                <button
                  class="primary small"
                  onClick={() => act('POST', `/admin/games/${g.id}/start`, {}, 'Started')}
                >
                  {g.status === 'lobby' ? 'Start game' : 'Resume'}
                </button>
              )}
              {g.status === 'running' && (
                <button class="small" onClick={() => act('POST', `/admin/games/${g.id}/pause`, {}, 'Paused')}>
                  Pause
                </button>
              )}
              {g.status !== 'finished' && (
                <>
                  <button
                    class="small"
                    onClick={() => {
                      const d = prompt('Fast-forward how many game days?', '1');
                      if (d)
                        void act('POST', `/admin/games/${g.id}/skip`, { days: Number(d) }, 'Time advanced');
                    }}
                  >
                    Skip days
                  </button>
                  <button class="small" onClick={() => invite(g.id)}>
                    Invite link
                  </button>
                  <button
                    class="small"
                    onClick={() => {
                      setEditing(editing === g.id ? null : g.id);
                      setEdit({});
                    }}
                  >
                    Settings
                  </button>
                  <button
                    class="small danger"
                    onClick={() =>
                      confirm(`End "${g.name}" now? The richest company wins.`) &&
                      act('POST', `/admin/games/${g.id}/end`, {}, 'Game ended')
                    }
                  >
                    End
                  </button>
                </>
              )}
              <button
                class="small danger right"
                onClick={() =>
                  confirm(`Delete "${g.name}" permanently?`) &&
                  act('DELETE', `/admin/games/${g.id}`, undefined, 'Deleted')
                }
              >
                Delete
              </button>
            </div>
            <div class="small-text muted">
              {g.settings.timeScale}× time · deadline {g.settings.actionDeadlineHours}h · start cash{' '}
              {formatMoney(g.settings.startingCash)} · max {g.settings.maxPlayers} players ·{' '}
              {g.settings.durationDays ? `${g.settings.durationDays} days` : 'endless'}
            </div>
            {editing === g.id && (
              <form
                class="col"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act('PATCH', `/admin/games/${g.id}`, { settings: edit }, 'Settings saved').then(() =>
                    setEditing(null),
                  );
                }}
              >
                <SettingsForm
                  value={{ ...g.settings, ...edit }}
                  onChange={(k, v) => setEdit({ ...edit, [k]: v })}
                />
                <button class="primary small" type="submit">
                  Save settings
                </button>
              </form>
            )}
            <table class="small-text">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Company</th>
                  <th class="num">Cash</th>
                  <th class="num">Ships</th>
                  <th class="num">Pending</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {g.members.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>
                      {m.company}
                      {m.bankrupt ? ' (bankrupt)' : ''}
                    </td>
                    <td class="num">
                      <Money v={m.cash} />
                    </td>
                    <td class="num">{m.ships}</td>
                    <td class="num">{m.pending}</td>
                    <td class="num">
                      <button
                        class="small danger"
                        onClick={() =>
                          confirm(`Remove ${m.name} and their fleet from the game?`) &&
                          act('DELETE', `/admin/games/${g.id}/members/${m.id}`, undefined, 'Removed')
                        }
                      >
                        Kick
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div class={`row ${users.some((u) => !g.members.some((m) => m.id === u.id)) ? '' : 'hidden'}`}>
              <select id={`add-${g.id}`}>
                {users
                  .filter((u) => !g.members.some((m) => m.id === u.id))
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName} ({u.username})
                    </option>
                  ))}
              </select>
              <button
                class="small"
                onClick={() => {
                  const sel = document.getElementById(`add-${g.id}`) as HTMLSelectElement | null;
                  if (sel?.value)
                    void act('POST', `/admin/games/${g.id}/members`, { userId: sel.value }, 'Player added');
                }}
              >
                Add player
              </button>
            </div>
          </div>
        </div>
      ))}
      <form class="win" onSubmit={create}>
        <div class="title">New game</div>
        <div class="body col">
          <label>
            <span>Name (e.g. the group of friends)</span>
            <input value={name} onInput={(e) => setName(e.currentTarget.value)} required minLength={2} />
          </label>
          <SettingsForm
            value={{ ...DEFAULT_SETTINGS, ...settings }}
            onChange={(k, v) => setSettings({ ...settings, [k]: v })}
          />
          <p class="small-text muted" style={{ margin: 0 }}>
            The game clock starts at the current date and time when you press <b>Start game</b>. Players see
            times in their own time zone.
          </p>
          <label class="row">
            <input
              type="checkbox"
              checked={joinSelf}
              onChange={(e) => setJoinSelf(e.currentTarget.checked)}
            />{' '}
            Join as a player myself
          </label>
          <button class="primary" type="submit">
            Create game
          </button>
        </div>
      </form>
    </div>
  );
}

function SettingsForm({
  value,
  onChange,
}: {
  value: GameSettings;
  onChange: (k: keyof GameSettings, v: number) => void;
}) {
  return (
    <div class="cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
      {SETTING_FIELDS.map(([k, label, hint]) => (
        <label key={k}>
          <span class="small-text">{label}</span>
          <input
            type="number"
            step="any"
            value={value[k]}
            onInput={(e) => onChange(k, Number(e.currentTarget.value))}
          />
          {hint && <span class="small-text muted">{hint}</span>}
        </label>
      ))}
    </div>
  );
}

function UsersTab({ users, act }: { users: AdminUser[]; act: Act }) {
  const [form, setForm] = useState({ username: '', password: '', displayName: '', isAdmin: false });
  return (
    <div class="col" style={{ gap: '14px' }}>
      <table class="small-text">
        <thead>
          <tr>
            <th>User</th>
            <th>Role</th>
            <th>Last seen</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>
                <b>{u.displayName}</b> <span class="muted">({u.username})</span>
              </td>
              <td>
                {u.isAdmin ? 'admin' : 'player'}
                {u.disabled ? ' · disabled' : ''}
              </td>
              <td>{u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : '—'}</td>
              <td class="num row" style={{ justifyContent: 'flex-end' }}>
                <button
                  class="small"
                  onClick={() => {
                    const pw = prompt(`New password for ${u.username} (min 8 chars)`);
                    if (pw)
                      void act(
                        'PATCH',
                        `/admin/users/${u.id}`,
                        { password: pw },
                        'Password reset — user signed out everywhere',
                      );
                  }}
                >
                  Reset pw
                </button>
                <button
                  class="small"
                  onClick={() => act('PATCH', `/admin/users/${u.id}`, { isAdmin: !u.isAdmin }, 'Updated')}
                >
                  {u.isAdmin ? 'Demote' : 'Make admin'}
                </button>
                <button
                  class="small"
                  onClick={() => act('PATCH', `/admin/users/${u.id}`, { disabled: !u.disabled }, 'Updated')}
                >
                  {u.disabled ? 'Enable' : 'Disable'}
                </button>
                <button
                  class="small danger"
                  onClick={() =>
                    confirm(`Delete ${u.username}?`) &&
                    act('DELETE', `/admin/users/${u.id}`, undefined, 'Deleted')
                  }
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          void act('POST', '/admin/users', form, 'User created').then(
            (r) => r && setForm({ username: '', password: '', displayName: '', isAdmin: false }),
          );
        }}
      >
        <input
          placeholder="username"
          value={form.username}
          onInput={(e) => setForm({ ...form, username: e.currentTarget.value })}
          required
        />
        <input
          placeholder="display name"
          value={form.displayName}
          onInput={(e) => setForm({ ...form, displayName: e.currentTarget.value })}
        />
        <input
          placeholder="password"
          type="password"
          value={form.password}
          onInput={(e) => setForm({ ...form, password: e.currentTarget.value })}
          required
          minLength={8}
        />
        <label class="row">
          <input
            type="checkbox"
            checked={form.isAdmin}
            onChange={(e) => setForm({ ...form, isAdmin: e.currentTarget.checked })}
          />{' '}
          admin
        </label>
        <button type="submit">Create user</button>
      </form>
    </div>
  );
}

function InvitesTab({ invites, games, act }: { invites: Invite[]; games: AdminGame[]; act: Act }) {
  const [gameId, setGameId] = useState('');
  const [maxUses, setMaxUses] = useState(5);
  const [days, setDays] = useState(14);
  const gameName = (id: string | null) =>
    id ? (games.find((g) => g.id === id)?.name ?? '?') : 'account only';
  return (
    <div class="col" style={{ gap: '14px' }}>
      <table class="small-text">
        <thead>
          <tr>
            <th>Code</th>
            <th>Game</th>
            <th>Uses</th>
            <th>Expires</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {invites.map((i) => (
            <tr key={i.code}>
              <td>
                <code>{i.code}</code>
              </td>
              <td>{gameName(i.gameId)}</td>
              <td>
                {i.uses}/{i.maxUses}
              </td>
              <td>{i.expiresAt ? new Date(i.expiresAt).toLocaleDateString() : 'never'}</td>
              <td class="num row" style={{ justifyContent: 'flex-end' }}>
                <button
                  class="small"
                  onClick={() =>
                    navigator.clipboard?.writeText(inviteLink(i.code)).then(() => toast('Link copied', 'ok'))
                  }
                >
                  Copy link
                </button>
                <button
                  class="small danger"
                  onClick={() => act('DELETE', `/admin/invites/${i.code}`, undefined, 'Deleted')}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          void act(
            'POST',
            '/admin/invites',
            { gameId: gameId || null, maxUses, expiresDays: days },
            'Invite created',
          );
        }}
      >
        <select value={gameId} onChange={(e) => setGameId(e.currentTarget.value)}>
          <option value="">Account only (no game)</option>
          {games
            .filter((g) => g.status !== 'finished')
            .map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
        </select>
        <label class="row">
          uses{' '}
          <input
            type="number"
            min={1}
            max={100}
            value={maxUses}
            onInput={(e) => setMaxUses(Number(e.currentTarget.value))}
            style={{ width: '70px' }}
          />
        </label>
        <label class="row">
          days{' '}
          <input
            type="number"
            min={0}
            value={days}
            onInput={(e) => setDays(Number(e.currentTarget.value))}
            style={{ width: '70px' }}
          />
        </label>
        <button type="submit">Create invite</button>
      </form>
    </div>
  );
}
