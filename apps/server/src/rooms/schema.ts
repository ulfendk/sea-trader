import { schema, t, type SchemaType } from '@colyseus/schema';

export const PlayerPub = schema(
  {
    id: t.string(),
    name: t.string(),
    company: t.string(),
    color: t.number(),
    netWorth: t.number(),
    ships: t.number(),
    bankrupt: t.boolean(),
    online: t.number(),
  },
  'PlayerPub',
);
export type PlayerPub = SchemaType<typeof PlayerPub>;

export const ShipPub = schema(
  {
    id: t.string(),
    owner: t.string(),
    name: t.string(),
    classId: t.string(),
    status: t.string(),
    port: t.string(),
    from: t.string(),
    to: t.string(),
    progressNm: t.number(),
    distance: t.number(),
    speed: t.number(),
    holdUntil: t.number(),
    waiting: t.boolean(),
  },
  'ShipPub',
);
export type ShipPub = SchemaType<typeof ShipPub>;

export const NewsItem = schema({ day: t.number(), text: t.string(), kind: t.string() }, 'NewsItem');
export type NewsItem = SchemaType<typeof NewsItem>;

export const GameStateSchema = schema(
  {
    gameId: t.string(),
    name: t.string(),
    day: t.number(),
    /** Server wall clock (ms) when `day` was computed, for client-side interpolation. */
    serverTs: t.number(),
    status: t.string(),
    timeScale: t.number(),
    startYear: t.number(),
    durationDays: t.number(),
    fuelIndex: t.number(),
    shipIndex: t.number(),
    players: t.map(PlayerPub),
    ships: t.map(ShipPub),
    news: t.array(NewsItem),
    winner: t.string(),
  },
  'GameStateSchema',
);
export type GameStateSchema = SchemaType<typeof GameStateSchema>;
