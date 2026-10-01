-- exp/jev: raw System One judgments (TypeSafe/Jev) as first-class records.
-- Every Jev stage writes its full typed answers here — probabilities, not
-- just the decided label — so thresholds can be re-tuned and decisions
-- re-derived in code without re-running inference, and Jev can be compared
-- against the LLM labels it may replace. One row per (subject, family):
-- re-judging replaces the row; history stays in audit_log.
CREATE TABLE judgments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    consultation_id uuid NOT NULL REFERENCES consultations(id),
    -- 'point' | 'map_point' | 'statement' | 'stance' | 'point_source' | ...
    subject_kind text NOT NULL,
    -- uuid of the subject, or a composite key (e.g. submission:statement).
    subject_id text NOT NULL,
    -- question family + version, e.g. 'grammar.v1', 'door.v1', 'stance.v1'.
    family text NOT NULL,
    model text NOT NULL,
    request_id text,
    -- Raw typed answers keyed by question id (probabilities included).
    answers jsonb NOT NULL,
    -- What code derived from the answers under the current policy.
    decided jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (subject_kind, subject_id, family)
);
CREATE INDEX judgments_consultation_family_idx ON judgments (consultation_id, family);

ALTER TABLE judgments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_judgments ON judgments
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON judgments TO policy_app;

-- Calibrated strength of an inferred vote (P of the decided stance); NULL for
-- real votes and for votes inferred before calibration existed.
ALTER TABLE votes ADD COLUMN confidence real;
