import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema.ts";

export * from "./schema.ts";
export { schema };
// Query operators re-exported so app code never imports drizzle-orm directly —
// the db package stays the single place that owns the ORM dependency.
export { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

export type Db = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return drizzle(pool, { schema });
}
