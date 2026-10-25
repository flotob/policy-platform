import { createDbFromPool, type Db } from "@policy/db";
import pg from "pg";

let pool: pg.Pool | undefined;
let db: Db | undefined;

/** One connection pool for the app: queries and the auth library share it. */
export function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (apps/beteiligung/.env.local)");
    pool = new pg.Pool({ connectionString: url, max: 10 });
  }
  return pool;
}

export function getDb(): Db {
  if (!db) db = createDbFromPool(getPool());
  return db;
}
