function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export const config = {
  port: Number(process.env.PORT ?? 2567),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/seatrader',
  /** Public URL of the web app (used in push notification links). */
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  /** Comma separated list of allowed browser origins for the API (e.g. GitHub Pages). */
  corsOrigins: (
    process.env.CORS_ORIGINS ?? (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173')
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  serveWeb: bool(process.env.SERVE_WEB, true),
  webDist: process.env.WEB_DIST ?? new URL('../../web/dist', import.meta.url).pathname,
  trustProxy: process.env.TRUST_PROXY ?? '',
  adminUsername: process.env.ADMIN_USERNAME ?? '',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
  /** Real milliseconds between game clock ticks. */
  tickMs: Number(process.env.TICK_MS ?? 5000),
  /** Allow open registration without an invite code. */
  openRegistration: bool(process.env.OPEN_REGISTRATION, false),
  sessionDays: Number(process.env.SESSION_DAYS ?? 180),
};
