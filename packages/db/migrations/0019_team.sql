-- Team accounts (apps/beteiligung): a municipality invites its staff by email.
-- The link in the email carries a random token; only its SHA-256 is stored.
-- Accepting creates the account (or uses an existing one) and the membership.
-- Platform admins (env PLATFORM_ADMINS) invite the first person of a new
-- municipality the same way; sign-up itself stays closed.

CREATE TABLE staff_invites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email text NOT NULL,
    role text NOT NULL CHECK (role IN ('initiator', 'redaktion', 'betrachter')),
    token_hash text NOT NULL UNIQUE,
    -- auth_user id of the inviting person (a colleague, or a platform admin for a new municipality).
    invited_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    sent_at timestamptz,
    accepted_at timestamptz,
    accepted_by text REFERENCES auth_user(id) ON DELETE SET NULL,
    withdrawn_at timestamptz
);
CREATE INDEX staff_invites_tenant_idx ON staff_invites (tenant_id, created_at DESC);

ALTER TABLE staff_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_staff_invites ON staff_invites
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_invites TO policy_app;
