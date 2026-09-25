import { config } from './config.js';
import { liveRooms } from './games.js';
import { startServer } from './server.js';

startServer(config.port)
  .then(() => {
    console.log(`Sea Trader server listening on :${config.port}`);
    console.log(`${liveRooms.size} game room(s) running`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
