import pg from "pg";
import { config } from "./config.js";

// Postgres BIGINT (OID 20) is returned as a string by default to avoid
// precision loss. Our ids and counts fit comfortably in a JS number,
// so we parse them for a cleaner JSON response.
pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.useSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export type PoolClient = pg.PoolClient;
