-- Argument model (roadmap §5): submissions, points, statements, edges,
-- provenance spans, and first-class match decisions.

ALTER TABLE consultations
    ADD COLUMN source_system text,
    ADD COLUMN source_ref text;
CREATE UNIQUE INDEX consultations_source_idx
    ON consultations (tenant_id, source_system, source_ref)
    WHERE source_system IS NOT NULL;

-- A submission: any of the three doors, stored verbatim.
CREATE TABLE submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    consultation_id uuid NOT NULL REFERENCES consultations(id),
    door text NOT NULL CHECK (door IN ('vote', 'statement', 'document')),
    author_org text,
    author_type text,
    language text,
    source_system text,
    source_ref text,
    text text,
    submitted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (consultation_id, source_system, source_ref)
);

-- The atom of the map.
CREATE TABLE points (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    consultation_id uuid NOT NULL REFERENCES consultations(id),
    kind text NOT NULL CHECK (kind IN ('fact', 'value', 'design', 'gap')),
    slot text CHECK (slot IN ('P1', 'P2', 'P3', 'P4', 'conclusion')),
    label text NOT NULL,
    summary text,
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'released', 'rejected', 'merged')),
    merged_into uuid REFERENCES points(id),
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Typed edges: support plus the five critical questions.
CREATE TABLE point_edges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    from_point uuid NOT NULL REFERENCES points(id),
    to_point uuid NOT NULL REFERENCES points(id),
    kind text NOT NULL CHECK (kind IN (
        'supports', 'empirics', 'alternatives', 'goal_conflict',
        'feasibility', 'value_conflict'
    )),
    UNIQUE (from_point, to_point, kind)
);

-- The votable, neutrally-phrased rendering of a point, per locale.
CREATE TABLE statements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    point_id uuid NOT NULL REFERENCES points(id),
    locale text NOT NULL,
    text text NOT NULL,
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'released', 'retired')),
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (point_id, locale, version)
);

-- Provenance: every point links to the submission text that fed it.
CREATE TABLE point_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    point_id uuid NOT NULL REFERENCES points(id),
    submission_id uuid NOT NULL REFERENCES submissions(id),
    quote text,
    span_start integer,
    span_end integer,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- The platform's most consequential judgment, as a first-class record:
-- was a candidate a known point or a new one?
CREATE TABLE match_decisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    consultation_id uuid NOT NULL REFERENCES consultations(id),
    submission_id uuid NOT NULL REFERENCES submissions(id),
    candidate_label text NOT NULL,
    candidate_summary text,
    outcome text NOT NULL CHECK (outcome IN ('matched', 'new')),
    matched_point uuid REFERENCES points(id),
    confidence real,
    method text NOT NULL,
    provenance jsonb,
    reviewer text,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: same fail-closed pattern as schema v0.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'submissions', 'points', 'point_edges', 'statements',
        'point_sources', 'match_decisions'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%I ON %I
             USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)
             WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
            t, t
        );
    END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON submissions, points, point_edges, statements,
    point_sources, match_decisions TO policy_app;
