import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

import { authOptions } from "./auth-options";
import { getPool } from "./db";

/** Staff login (Better Auth on our Postgres). nextCookies lets server actions set the session cookie. */
export const auth = betterAuth({
  ...authOptions,
  database: getPool(),
  plugins: [nextCookies()],
});
