import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { configureApp } from './app.js';
import { ensureAdmin } from './auth.js';
import { runMigrations } from './db/index.js';
import { bootRooms, liveRooms, pruneNotifications } from './games.js';
import { initPush } from './push.js';
import { startFeeds } from './feeds.js';
import { GameRoom } from './rooms/GameRoom.js';

export async function startServer(port: number) {
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

  await server.listen(port);
  await bootRooms();
  const stopFeeds = startFeeds(() => {
    for (const room of liveRooms.values()) room.applyFeeds();
  });
  const prune = setInterval(() => void pruneNotifications().catch(() => undefined), 6 * 3600_000);
  return {
    server,
    async close() {
      clearInterval(prune);
      stopFeeds();
      await Promise.all([...liveRooms.values()].map((r) => r.save()));
      await matchMaker.disconnectAll();
      await server.gracefullyShutdown(false);
    },
  };
}
