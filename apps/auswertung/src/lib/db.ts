import { createDb, type Db } from "@policy/db";

let db: Db | undefined;

/** Read-only use: the app never writes to the database. */
export function getDb(): Db {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (apps/auswertung/.env.local)");
    db = createDb(url);
  }
  return db;
}
