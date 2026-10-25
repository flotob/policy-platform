import type { BetterAuthOptions } from "better-auth";

/**
 * Staff accounts of the municipalities (Better Auth). Citizens never log in:
 * they take part with a pseudonymous cookie (Stephan's Gesamtmodell, B1).
 * Tables are prefixed auth_ and use snake_case like the rest of the schema;
 * migration 0015 creates them (generated from these options by
 * scripts/auth-sql.ts — keep both in step).
 */
export const authOptions = {
  appName: "Landkarte des Streits",
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    // No mail provider yet: accounts work without confirming the address.
    requireEmailVerification: false,
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
