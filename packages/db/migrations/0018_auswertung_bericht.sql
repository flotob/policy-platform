-- Beteiligung, milestone 4: evaluation and report (Gesamtmodell B13, W1–W9,
-- R1–R5). Closing the participation freezes the vote matrix; the machine
-- computes the result object once (W9) — camps, profiles, findings, step
-- verdicts, gaps, evidence, saturation — and every sentence of the report
-- points back into it (I8).

-- (1) The result object (W9) -------------------------------------------------

CREATE TABLE campaign_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    version integer NOT NULL,
    -- What it was computed from: the vote matrix and the graph (released
    -- statements, their links and evidence), each as a hash.
    matrix_hash text NOT NULL,
    graph_hash text NOT NULL,
    result jsonb NOT NULL,
    -- Camp names: proposed by the language model, confirmed by the editors.
    -- The only part that may still change, and only until a report on this
    -- result is released.
    camp_names jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (campaign_id, version)
);

CREATE FUNCTION campaign_results_frozen() RETURNS trigger AS $$
BEGIN
    IF NEW.result IS DISTINCT FROM OLD.result OR NEW.matrix_hash IS DISTINCT FROM OLD.matrix_hash
       OR NEW.graph_hash IS DISTINCT FROM OLD.graph_hash OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id THEN
        RAISE EXCEPTION 'campaign_results are immutable (W9)';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campaign_results_no_change BEFORE UPDATE ON campaign_results
    FOR EACH ROW EXECUTE FUNCTION campaign_results_frozen();

-- (2) The report (R1–R5) -----------------------------------------------------

-- liste: R1 written (templates, no AI) · text: R2 written · geprueft: R3
-- passed · durchgefallen: R3 failed twice, the editors see why ·
-- zurueckgewiesen: R4 rejected (a new version follows) · freigegeben: R4 ·
-- veroeffentlicht: R5.
CREATE TABLE campaign_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    result_id uuid NOT NULL REFERENCES campaign_results(id) ON DELETE CASCADE,
    version integer NOT NULL,
    state text NOT NULL DEFAULT 'liste'
        CHECK (state IN ('liste', 'text', 'geprueft', 'durchgefallen', 'zurueckgewiesen', 'freigegeben', 'veroeffentlicht')),
    sentences jsonb NOT NULL,
    text jsonb,
    checks jsonb,
    -- Why the editors sent the previous version back (R4) — the next R2 reads it.
    feedback text,
    decided_by text,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (campaign_id, version)
);

-- (3) The machine's jobs for both ---------------------------------------------

ALTER TABLE campaign_jobs ADD COLUMN result_id uuid REFERENCES campaign_results(id) ON DELETE CASCADE;
ALTER TABLE campaign_jobs ADD COLUMN report_id uuid REFERENCES campaign_reports(id) ON DELETE CASCADE;
ALTER TABLE campaign_jobs DROP CONSTRAINT campaign_jobs_kind_check;
ALTER TABLE campaign_jobs ADD CONSTRAINT campaign_jobs_kind_check
    CHECK (kind IN ('skelett', 'zerlegen', 'kurzaussage', 'lagernamen', 'bericht'));

-- (4) Row-level security, as everywhere -----------------------------------------

ALTER TABLE campaign_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_campaign_results ON campaign_results
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON campaign_results TO policy_app;

ALTER TABLE campaign_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_campaign_reports ON campaign_reports
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_reports TO policy_app;
