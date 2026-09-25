import { useEffect, useState } from 'preact/hooks';
import { api, me, refreshMe, setToken } from '../api';
import { API_URL, SERVER_URL } from '../env';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../push';
import { toast } from '../toast';
import { Win } from '../ui';

interface Session {
  id: string;
  kind: string;
  label: string;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export function Settings() {
  const user = me.value!.user;
  const [sessions, setSessions] = useState<Session[]>([]);
  const [name, setName] = useState(user.displayName);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [push, setPush] = useState(false);
  const [apiToken, setApiToken] = useState('');

  const load = () => api<Session[]>('GET', '/sessions').then(setSessions);
  useEffect(() => {
    void load();
    void currentSubscription().then((s) => setPush(!!s));
  }, []);

  const err = (e: unknown) => toast(e instanceof Error ? e.message : String(e), 'err');

  async function saveName(e: Event) {
    e.preventDefault();
    try {
      await api('PATCH', '/me', { displayName: name });
      await refreshMe();
      toast('Saved', 'ok');
    } catch (e2) {
      err(e2);
    }
  }
  async function savePw(e: Event) {
    e.preventDefault();
    try {
      await api('PATCH', '/me', { password: newPw, oldPassword: oldPw });
      setOldPw('');
      setNewPw('');
      toast('Password changed', 'ok');
    } catch (e2) {
      err(e2);
    }
  }
  async function togglePush() {
    try {
      if (push) await disablePush();
      else await enablePush();
      setPush(!push);
      toast(push ? 'Notifications off' : 'Notifications on for this device', 'ok');
    } catch (e2) {
      err(e2);
    }
  }
  async function revoke(s: Session) {
    await api('DELETE', `/sessions/${s.id}`);
    if (s.current) setToken(null);
    else void load();
  }
  async function newToken() {
    try {
      const r = await api<{ token: string }>('POST', '/tokens', { label: 'Omarchy status bar' });
      setApiToken(r.token);
      void load();
    } catch (e2) {
      err(e2);
    }
  }

  const serverUrl = SERVER_URL || window.location.origin;
  return (
    <div class="page col" style={{ gap: '16px' }}>
      <Win title="Profile">
        <form class="row" onSubmit={saveName}>
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} maxLength={24} />
          <button type="submit">Save name</button>
        </form>
        <form class="row" style={{ marginTop: '10px' }} onSubmit={savePw}>
          <input
            type="password"
            placeholder="Current password"
            value={oldPw}
            onInput={(e) => setOldPw(e.currentTarget.value)}
            autoComplete="current-password"
          />
          <input
            type="password"
            placeholder="New password"
            value={newPw}
            onInput={(e) => setNewPw(e.currentTarget.value)}
            minLength={8}
            autoComplete="new-password"
          />
          <button type="submit" disabled={!oldPw || newPw.length < 8}>
            Change password
          </button>
        </form>
      </Win>

      <Win title="Notifications on this device">
        {pushSupported() ? (
          <div class="row">
            <span class="grow">Get a push notification when a ship needs a decision or awaits orders.</span>
            <button class={push ? '' : 'primary'} onClick={togglePush}>
              {push ? 'Turn off' : 'Turn on'}
            </button>
          </div>
        ) : (
          <p class="muted">
            This browser does not support push notifications. On iOS, add Sea Trader to the home screen first.
          </p>
        )}
      </Win>

      <Win title="Devices & sessions">
        <table>
          <thead>
            <tr>
              <th>Device</th>
              <th>Type</th>
              <th>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.label || '—'} {s.current && <b>(this)</b>}
                </td>
                <td>{s.kind === 'api' ? 'token' : 'login'}</td>
                <td class="nowrap">{new Date(s.lastUsedAt).toLocaleString()}</td>
                <td class="num">
                  <button class="small danger" onClick={() => revoke(s)}>
                    {s.current ? 'Sign out' : 'Revoke'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Win>

      <Win title="Omarchy status bar (Waybar)">
        <p style={{ marginTop: 0 }}>
          Create a token for the <code>sea-trader-status</code> Waybar module. It shows how many ships need
          you and opens the game as a floating window.
        </p>
        <button onClick={newToken}>Create status bar token</button>
        {apiToken && (
          <div style={{ marginTop: '10px' }}>
            <p>
              Copy this now — it is shown only once. Put it in <code>~/.config/sea-trader/config</code>:
            </p>
            <pre>{`SEA_TRADER_API=${API_URL.startsWith('http') ? API_URL : serverUrl + '/api'}
SEA_TRADER_URL=${window.location.origin}${import.meta.env.BASE_URL}
SEA_TRADER_TOKEN=${apiToken}`}</pre>
            <p class="small-text muted">
              Or run the installer from the repo: <code>integrations/omarchy/install.sh</code>
            </p>
          </div>
        )}
      </Win>
    </div>
  );
}
