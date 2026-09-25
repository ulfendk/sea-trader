import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { config } from '../config.js';
import * as schema from './schema.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
export const db = drizzle(pool, { schema });
export type DB = typeof db;

export async function runMigrations() {
  const folder = new URL('../../drizzle', import.meta.url).pathname;
  await migrate(db, { migrationsFolder: folder });
}

export { schema };
