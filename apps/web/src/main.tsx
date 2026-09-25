import { render } from 'preact';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/vt323/400.css';
import './styles.css';
import { App } from './app';

render(<App />, document.getElementById('app')!);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}
