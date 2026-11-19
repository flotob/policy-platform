-- Citizens report what should not stand there (apps/beteiligung): an insult, a private person
-- named, a contribution twisted. The editors decide: hide it (with a logged reason) or keep it.
-- Hiding a quote keeps its vote (moves.flags gets 'versteckt'); hiding a statement takes it out of
-- the vote (map_points.status = 'rejected'). Who reported is known only as a salted connection hash.
CREATE TABLE content_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    subject_kind text NOT NULL CHECK (subject_kind IN ('node', 'move')),
    subject_id uuid NOT NULL,
    reason text NOT NULL CHECK (reason IN ('beleidigend', 'persoenlich', 'falsch', 'sonstiges')),
    note text,
    origin_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    state text NOT NULL DEFAULT 'offen' CHECK (state IN ('offen', 'ausgeblendet', 'bleibt')),
    decided_by text,
    decided_at timestamptz,
    decision_reason text,
    UNIQUE (campaign_id, subject_kind, subject_id, origin_hash)
);
CREATE INDEX content_reports_open_idx ON content_reports (campaign_id, state);

ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_content_reports ON content_reports
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON content_reports TO policy_app;
