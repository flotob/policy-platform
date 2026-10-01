-- exp/jev pipeline, part 2.

-- (1) Window plans: where a long submission is cut into extraction windows.
-- Cut points are chosen by Jev ("does a new topic start here?") and kept
-- here so the windows — and with them the extraction cache keys — stay
-- stable across runs and resets (like `extractions`, never reset).
CREATE TABLE window_plans (
    submission_id uuid NOT NULL REFERENCES submissions(id),
    max_chars integer NOT NULL,
    -- Character offsets where windows end (exclusive), ascending; the last is text length.
    cuts integer[] NOT NULL,
    -- Raw Jev answers per cut decision (probabilities per candidate break).
    answers jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (submission_id, max_chars)
);

-- (2) Refined candidates per extraction window: after the Jev intake
-- judgment and the automatic repair by the LLM editor (split / rewrite /
-- drop), each with its intake answers and decision. Canonicalization reads
-- these. Cleared (with canonicalized_at) only when the refine policy changes.
ALTER TABLE extractions ADD COLUMN refined jsonb;
ALTER TABLE extractions ADD COLUMN refined_at timestamptz;

-- (3) Documents of a consultation — above all the bill itself: measures are
-- read from the bill, not inferred from what submissions talk about.
CREATE TABLE consultation_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    consultation_id uuid NOT NULL REFERENCES consultations(id),
    -- e.g. 'drucksache:Gesetzentwurf', 'consultation_document'
    kind text NOT NULL,
    filename text NOT NULL,
    source_url text,
    text text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (consultation_id, filename)
);

-- (4) Votes on Landkarten-Punkte: participants vote on the points of the
-- map itself (paper §8), not on per-extraction-point statements.
CREATE TABLE map_point_votes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    participant_id uuid NOT NULL REFERENCES participants(id),
    map_point_id uuid NOT NULL REFERENCES map_points(id) ON DELETE CASCADE,
    value smallint NOT NULL CHECK (value IN (-1, 0, 1)),
    -- 'inferred' (from a submission's text) | 'real'
    method text NOT NULL DEFAULT 'inferred',
    -- Calibrated strength of an inferred vote; NULL for real votes.
    confidence real,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (participant_id, map_point_id)
);
CREATE INDEX map_point_votes_map_point_idx ON map_point_votes (map_point_id);

-- (5) Relations judged across submissions carry their strength and origin.
ALTER TABLE point_edges ADD COLUMN confidence real;
ALTER TABLE point_edges ADD COLUMN created_by text;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['consultation_documents', 'map_point_votes'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%s ON %I
               USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)
               WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
            t, t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO policy_app', t);
    END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON window_plans TO policy_app;
