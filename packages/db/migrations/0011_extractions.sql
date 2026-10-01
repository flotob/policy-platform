-- exp/jev: the extraction cache. Decomposition is split into two phases:
-- (1) EXTRACTION — one LLM call per text window, all windows in parallel,
--     raw output stored here, keyed by the exact call (system + prompt +
--     schema + model); a rerun with an unchanged call costs nothing;
-- (2) CANONICALIZATION — Jev matches every extracted candidate against the
--     map in a fixed order and judges new points; it consumes the rows
--     below and marks them. Resetting a consultation's derived data clears
--     canonicalized_at and keeps the extractions — every downstream
--     iteration then runs without a single LLM extraction call.
CREATE TABLE extractions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    consultation_id uuid NOT NULL REFERENCES consultations(id),
    submission_id uuid NOT NULL REFERENCES submissions(id),
    -- Window position: index/count plus its character range in submissions.text.
    window_index integer NOT NULL,
    window_count integer NOT NULL,
    window_start integer NOT NULL,
    window_end integer NOT NULL,
    -- sha256 over system + prompt + schema + model: the cache key.
    call_hash text NOT NULL,
    model text NOT NULL,
    -- Raw structured output of the LLM (candidate points).
    output jsonb NOT NULL,
    -- Call provenance (provider, model, promptHash, startedAt, durationMs).
    provenance jsonb NOT NULL,
    canonicalized_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (submission_id, window_index, call_hash)
);
CREATE INDEX extractions_consultation_idx ON extractions (consultation_id, canonicalized_at);

ALTER TABLE extractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_extractions ON extractions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON extractions TO policy_app;
