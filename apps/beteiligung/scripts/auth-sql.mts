/** Print the SQL Better Auth needs for our options (copied into migration 0015). */
import { getMigrations } from "better-auth/db/migration";
import pg from "pg";

import { authOptions } from "../src/lib/auth-options.ts";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { compileMigrations } = await getMigrations({ ...authOptions, database: pool });
console.log(await compileMigrations());
await pool.end();
