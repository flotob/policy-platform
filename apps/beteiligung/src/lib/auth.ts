import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

import { authOptions } from "./auth-options";
import { getPool } from "./db";
import { sendPasswordReset } from "./team";

/** Staff login (Better Auth on our Postgres). nextCookies lets server actions set the session cookie. */
export const auth = betterAuth({
  ...authOptions,
  emailAndPassword: {
    ...authOptions.emailAndPassword,
    // The email links to our own page /passwort-neu, which sends the token back with the new password.
    sendResetPassword: async ({ user, token }) => sendPasswordReset(user, token),
    resetPasswordTokenExpiresIn: 3600,
    revokeSessionsOnPasswordReset: true,
  },
  database: getPool(),
  plugins: [nextCookies()],
});
