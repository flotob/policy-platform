-- Schema v0: tenancy, RLS, append-only audit log, job queue, documents.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consultations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    title text NOT NULL,
    status text NOT NULL DEFAULT 'draft',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    filename text NOT NULL,
    blob_path text NOT NULL,
    sha256 text,
    size integer,
    extracted_text text,
    extraction_tool text,
    created_at timestamptz NOT NULL DEFAULT now(),
    extracted_at timestamptz
);

-- Job queue: Postgres is the only bus between core and workers.
CREATE TABLE jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL,
    payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'done', 'failed')),
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    result jsonb,
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz
);
CREATE INDEX jobs_pending_idx ON jobs (created_at) WHERE status = 'pending';

-- Append-only audit log: every mutation that matters, attributable, immutable.
CREATE TABLE audit_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid,
    actor text NOT NULL,
    action text NOT NULL,
    subject_kind text,
    subject_id text,
    reason text,
    payload jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- Row-level security: tenant isolation enforced in one place.
-- App connections run SET app.tenant_id = '<uuid>'; the policies do the rest.
ALTER TABLE consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_consultations ON consultations
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_documents ON documents
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Non-owner role the app/tests can assume; RLS applies to it (owners bypass).
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'policy_app') THEN
        CREATE ROLE policy_app NOLOGIN;
    END IF;
END $$;

GRANT USAGE ON SCHEMA public TO policy_app;
GRANT SELECT, INSERT, UPDATE ON tenants, consultations, documents, jobs TO policy_app;
GRANT SELECT, INSERT ON audit_log TO policy_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO policy_app;
