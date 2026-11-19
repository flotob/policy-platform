import type { BetterAuthOptions } from "better-auth";

/**
 * Staff accounts of the municipalities (Better Auth). Citizens never log in:
 * they take part with a pseudonymous cookie (Stephan's Gesamtmodell, B1).
 * Tables are prefixed auth_ and use snake_case like the rest of the schema;
 * migration 0015 creates them (generated from these options by
 * scripts/auth-sql.ts — keep both in step).
 */
export const authOptions = {
  appName: "streit.bar",
  // No screen uses these, and on a shared demo account they would let one visitor lock out the others.
  disabledPaths: [
    "/change-password",
    "/set-password",
    "/change-email",
    "/update-user",
    "/delete-user",
    "/revoke-session",
    "/revoke-sessions",
    "/revoke-other-sessions",
    "/link-social",
    "/unlink-account",
    // Nothing on the site needs these over HTTP either; some would hand out session rows (IP address, browser)
    // of everyone on the shared demo account. Sign-in, sign-out and the reset run through our server actions.
    "/list-sessions",
    "/update-session",
    "/verify-password",
    "/list-accounts",
    "/account-info",
    "/get-access-token",
    "/refresh-token",
    "/send-verification-email",
    "/verify-email",
    "/sign-in/social",
    "/sign-up/email",
    "/delete-user/callback",
  ],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    // Accounts come from emailed invitations (lib/team.ts), whose link already proves the address.
    requireEmailVerification: false,
    // Better Auth's own sign-up endpoint stays off: accounts are created by our server actions only,
    // after the registration code (lib/signup.ts) or an invitation (lib/team.ts) was checked.
    disableSignUp: true,
  },
  user: {
    modelName: "auth_user",
    fields: { emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at" },
  },
  session: {
    modelName: "auth_session",
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      userId: "user_id",
    },
  },
  account: {
    modelName: "auth_account",
    fields: {
      accountId: "account_id",
      providerId: "provider_id",
      userId: "user_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  verification: {
    modelName: "auth_verification",
    fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" },
  },
} satisfies BetterAuthOptions;
