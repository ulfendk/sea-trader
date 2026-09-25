import { useState } from 'preact/hooks';
import { api, deviceLabel, refreshMe, setToken, type User } from '../api';
import { query } from '../router';
import { Win } from '../ui';

export function Login() {
  const invite = query.value.get('invite') ?? '';
  const [mode, setMode] = useState<'login' | 'register'>(invite ? 'register' : 'login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState(invite);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ token: string; user: User }>(
        'POST',
        mode === 'login' ? '/auth/login' : '/auth/register',
        {
          username,
          password,
          displayName: displayName || undefined,
          invite: code || undefined,
          device: deviceLabel(),
        },
      );
      setToken(res.token);
      await refreshMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="page" style={{ maxWidth: '460px', paddingTop: '8vh' }}>
      <h1 class="center" style={{ color: 'var(--yellow)', lineHeight: 1.6 }}>
        ⚓ SEA TRADER
      </h1>
      <p class="center muted" style={{ marginTop: '-4px' }}>
        A shipping empire, one voyage at a time.
      </p>
      <Win title={mode === 'login' ? 'Harbour Master — Sign in' : 'Register your company'}>
        <form class="col" onSubmit={submit}>
          <label>
            <span>Username</span>
            <input
              value={username}
              onInput={(e) => setUsername(e.currentTarget.value)}
              autoComplete="username"
              required
              minLength={3}
            />
          </label>
          {mode === 'register' && (
            <label>
              <span>Display name</span>
              <input
                value={displayName}
                onInput={(e) => setDisplayName(e.currentTarget.value)}
                placeholder="Captain Nemo"
                maxLength={24}
              />
            </label>
          )}
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onInput={(e) => setPassword(e.currentTarget.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'register' ? 8 : 1}
            />
          </label>
          {mode === 'register' && (
            <label>
              <span>Invite code</span>
              <input
                value={code}
                onInput={(e) => setCode(e.currentTarget.value.toUpperCase())}
                placeholder="From your game admin"
              />
            </label>
          )}
          {error && <div class="bad">{error}</div>}
          <div class="row">
            <button class="primary" type="submit" disabled={busy}>
              {mode === 'login' ? 'Sign in' : 'Register'}
            </button>
            <button
              type="button"
              class="link right"
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            >
              {mode === 'login' ? 'Have an invite? Register' : 'Already registered? Sign in'}
            </button>
          </div>
        </form>
      </Win>
    </div>
  );
}
