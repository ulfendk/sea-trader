import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { configureApp } from './app.js';
import { ensureAdmin } from './auth.js';
import { config } from './config.js';
import { runMigrations } from './db/index.js';
import { bootRooms, liveRooms, pruneNotifications } from './games.js';
import { initPush } from './push.js';
import { GameRoom } from './rooms/GameRoom.js';

async function main() {
  await runMigrations();
  await ensureAdmin();
  await initPush();

  const server = new Server({
    transport: new WebSocketTransport({ pingInterval: 15000, pingMaxRetries: 4 }),
    express: (app) => configureApp(app),
    greet: false,
  });
  server.define('game', GameRoom).filterBy(['gameId']);
  server.onBeforeShutdown(async () => {
    await Promise.all([...liveRooms.values()].map((r) => r.save()));
  });

  await server.listen(config.port);
  console.log(`Sea Trader server listening on :${config.port}`);
  await bootRooms();
  console.log(`${liveRooms.size} game room(s) running`);
  setInterval(() => void pruneNotifications().catch(() => undefined), 6 * 3600_000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
