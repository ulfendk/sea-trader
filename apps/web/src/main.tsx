import { render } from 'preact';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/vt323/400.css';
import './styles.css';
import { App } from './app';

render(<App />, document.getElementById('app')!);

/** How often an open app checks for a new version. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void import('virtual:pwa-register').then(({ registerSW }) =>
    registerSW({
      immediate: true,
      // Periodic service worker updates (vite-plugin-pwa): an installed app that stays open,
      // e.g. on a phone, otherwise only notices a new version on its next launch.
      onRegisteredSW(swUrl, registration) {
        if (!registration) return;
        const check = async () => {
          if (registration.installing || !navigator.onLine) return;
          // Skip the update when the server is unreachable, so an offline check doesn't error.
          const res = await fetch(swUrl, {
            cache: 'no-store',
            headers: { 'cache-control': 'no-cache' },
          }).catch(() => null);
          if (res?.status === 200) await registration.update().catch(() => undefined);
        };
        setInterval(check, UPDATE_CHECK_MS);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void check();
        });
      },
    }),
  );
}
