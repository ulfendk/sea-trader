/** Server origin: empty means same origin as the web app. Set VITE_SERVER_URL for split deployments (GitHub Pages). */
const configured = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, '') ?? '';
export const SERVER_URL = configured || (import.meta.env.DEV ? 'http://localhost:2567' : '');
export const API_URL = `${SERVER_URL}/api`;
export const COLYSEUS_URL = SERVER_URL || window.location.origin;
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
