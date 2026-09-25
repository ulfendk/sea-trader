import { useEffect, useState } from 'preact/hooks';
import { api, me, refreshMe, setToken, token } from './api';
import { match, navigate, path } from './router';
import { Loading, Toasts } from './ui';
import { Admin } from './screens/Admin';
import { Game } from './screens/Game';
import { Lobby } from './screens/Lobby';
import { Login } from './screens/Login';
import { Settings } from './screens/Settings';

export function App() {
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    refreshMe()
      .then(() => setOffline(false))
      .catch(() => setOffline(true))
      .finally(() => setReady(true));
  }, [token.value]);

  useEffect(() => {
    if (ready && me.value && path.value === '/login') navigate('/', true);
  }, [ready, me.value, path.value]);

  if (!ready) return <Loading />;
  if (offline && token.value)
    return (
      <div class="page center">
        <p>The harbour office is unreachable. Retrying…</p>
        <button onClick={() => location.reload()}>Retry now</button>
      </div>
    );
  if (!me.value)
    return (
      <>
        <Login />
        <Toasts />
      </>
    );

  const p = path.value;
  const user = me.value.user;
  const gameParams = match('/game/:id', p);
  const pendingTotal = me.value.games.reduce((a, g) => a + g.pending.length, 0);

  let screen;
  if (gameParams) screen = <Game id={gameParams.id} key={gameParams.id} />;
  else if (p === '/admin' && user.isAdmin) screen = <Admin />;
  else if (p === '/settings') screen = <Settings />;
  else screen = <Lobby />;

  return (
    <>
      <header class="topbar">
        <a
          class="logo"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
            void refreshMe();
          }}
        >
          ⚓ SEA TRADER
        </a>
        {!gameParams && pendingTotal > 0 && <span class="badge calm">{pendingTotal}</span>}
        <span class="right row" style={{ gap: '6px' }}>
          {gameParams && (
            <button class="small" onClick={() => navigate('/')}>
              Games
            </button>
          )}
          {user.isAdmin && (
            <button class="small" onClick={() => navigate('/admin')}>
              Admin
            </button>
          )}
          <button class="small" onClick={() => navigate('/settings')}>
            {user.displayName}
          </button>
          <button
            class="small"
            onClick={async () => {
              await api('POST', '/auth/logout').catch(() => undefined);
              setToken(null);
              navigate('/');
            }}
          >
            Sign out
          </button>
        </span>
      </header>
      {screen}
      <Toasts />
    </>
  );
}
