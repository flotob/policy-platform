-- Municipal participation app (apps/beteiligung): staff accounts,
-- memberships in a municipality, campaigns and their setup files.
-- Built against Stephan's Gesamtmodell (docs/stephan reloaded/): a campaign
-- ("Verfahren") puts exactly ONE measure up for discussion (E1); its
-- pipeline work happens on the consultation it owns (1:1).

-- (1) Staff accounts (Better Auth). Generated from
-- apps/beteiligung/src/lib/auth-options.ts by scripts/auth-sql.mts — keep
-- both in step. Citizens never get an account (pseudonymous cookie, B1).
create table "auth_user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "email_verified" boolean not null, "image" text, "created_at" timestamptz default CURRENT_TIMESTAMP not null, "updated_at" timestamptz default CURRENT_TIMESTAMP not null);
create table "auth_session" ("id" text not null primary key, "expires_at" timestamptz not null, "token" text not null unique, "created_at" timestamptz default CURRENT_TIMESTAMP not null, "updated_at" timestamptz not null, "ip_address" text, "user_agent" text, "user_id" text not null references "auth_user" ("id") on delete cascade);
create table "auth_account" ("id" text not null primary key, "account_id" text not null, "provider_id" text not null, "user_id" text not null references "auth_user" ("id") on delete cascade, "access_token" text, "refresh_token" text, "id_token" text, "access_token_expires_at" timestamptz, "refresh_token_expires_at" timestamptz, "scope" text, "password" text, "created_at" timestamptz default CURRENT_TIMESTAMP not null, "updated_at" timestamptz not null);
create table "auth_verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expires_at" timestamptz not null, "created_at" timestamptz default CURRENT_TIMESTAMP not null, "updated_at" timestamptz default CURRENT_TIMESTAMP not null);
create index "auth_session_user_id_idx" on "auth_session" ("user_id");
create index "auth_account_user_id_idx" on "auth_account" ("user_id");
create index "auth_verification_identifier_idx" on "auth_verification" ("identifier");

-- (2) A municipality is a tenant; its staff are members with a role (P2):
-- initiator = sets up and opens campaigns, redaktion = editorial gate,
-- betrachter = read only.
CREATE TABLE memberships (
    user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    role text NOT NULL CHECK (role IN ('initiator', 'redaktion', 'betrachter')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, tenant_id)
);

-- (3) Campaigns. State machine from the Gesamtmodell (section 5):
-- entwurf → vorbereitung → offen → auswertung → bericht → veroeffentlicht.
CREATE TABLE campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    consultation_id uuid NOT NULL UNIQUE REFERENCES consultations(id),
    -- Public URL: /<tenant slug>/<campaign slug>
    slug text NOT NULL,
    title text NOT NULL,
    -- The decision question put to the town ("Soll die Stadt …?").
    question text NOT NULL,
    -- Wording of the measure (E1).
    measure text NOT NULL,
    -- Short explanation for citizens on the entry page.
    summary text,
    -- The initiator's justification as free text; the machine proposes the
    -- four steps from it (E2).
    justification text,
    -- The four steps of the justification (artifact step model):
    -- {"lage": …, "wirkung": …, "weg": …, "eingriff": …}
    steps jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Procedure parameters with defaults in code (E3): doors, period,
    -- thresholds, editorial mode, question→step mapping. Never constants (I12).
    params jsonb NOT NULL DEFAULT '{}'::jsonb,
    state text NOT NULL DEFAULT 'entwurf'
        CHECK (state IN ('entwurf', 'vorbereitung', 'offen', 'auswertung', 'bericht', 'veroeffentlicht')),
    -- Demo campaigns with invented content are marked as such everywhere.
    fictional boolean NOT NULL DEFAULT false,
    created_by text REFERENCES auth_user(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, slug)
);

-- (4) Files uploaded at setup: the draft (statute, decision paper),
-- supporting material, existing statements (E4). Kept in the database (small
-- files, no volume needed); text extraction happens in the analysis step.
CREATE TABLE campaign_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('entwurf', 'unterlage', 'stellungnahme')),
    filename text NOT NULL,
    mime text,
    size integer NOT NULL,
    sha256 text NOT NULL,
    content bytea NOT NULL,
    -- Sender of an existing statement, and its kind (Verband, Behörde, …).
    sender text,
    sender_type text,
    uploaded_by text REFERENCES auth_user(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (campaign_id, sha256)
);

-- Tenant isolation like every other tenant table (the app connects as owner;
-- policy_app is the role RLS applies to).
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['memberships', 'campaigns', 'campaign_files'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%I ON %I
                USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)
                WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
            t, t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO policy_app', t);
    END LOOP;
END $$;
