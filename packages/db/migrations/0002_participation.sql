-- Participation: questionnaire answers, participants, votes, analysis runs.

ALTER TABLE submissions ADD COLUMN answers jsonb;

CREATE TABLE participants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    consultation_id uuid NOT NULL REFERENCES consultations(id),
    source_ref text,
    author_org text,
    author_type text,
    country text,
    language text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (consultation_id, source_ref)
);

CREATE TABLE votes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    participant_id uuid NOT NULL REFERENCES participants(id),
    statement_id uuid NOT NULL REFERENCES statements(id),
    value smallint NOT NULL CHECK (value IN (-1, 0, 1)),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (participant_id, statement_id)
);
CREATE INDEX votes_statement_idx ON votes (statement_id);

-- Stored analysis results: computed, versioned, reproducible.
CREATE TABLE analysis_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    consultation_id uuid NOT NULL REFERENCES consultations(id),
    engine text NOT NULL,
    thresholds jsonb,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['participants', 'votes', 'analysis_runs'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%I ON %I
             USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)
             WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
            t, t
        );
    END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON participants, votes, analysis_runs TO policy_app;
