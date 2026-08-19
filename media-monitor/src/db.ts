import pg from "pg";
import { config } from "./config.js";

pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.useSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export type PoolClient = pg.PoolClient;
