-- Beteiligung: the way back, the cross-check by lot, and news by e-mail (Stephan, paper v10).
--
-- (1) Gegenprobe durch Los: the town draws residents from its register and writes to them; their
--     codes are marked 'gelost'. A drawn person's votes count like everyone's and are also counted
--     separately: does a bridge hold among them too? Which participant came with a drawn code is
--     known through campaign_invites.participant_id — nothing else about them is stored.
-- (2) Der Rückweg: after the council has decided, the town notes for each statement how it was
--     handled (Stephan's closed list) with one sentence; every tracking slip gets a fifth station.
-- (3) Freiwillige Nachricht: a participant may leave an e-mail address to hear when the result is
--     out and when the council has decided. Confirmed by a link first; one click to unsubscribe.
--     The address is not stored with the participant's votes — only with the tracking-slip links
--     of the points they sent, so the message can point to them.

-- (1) -------------------------------------------------------------------------------------------
ALTER TABLE campaign_invites ADD COLUMN kind text NOT NULL DEFAULT 'einladung'
    CHECK (kind IN ('einladung', 'gelost'));
CREATE INDEX campaign_invites_participant_idx ON campaign_invites (participant_id) WHERE participant_id IS NOT NULL;

-- (2) -------------------------------------------------------------------------------------------
CREATE TABLE campaign_decisions (
    campaign_id uuid PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    gremium text NOT NULL DEFAULT 'Gemeinderat',
    datum date,
    -- What the council decided about the measure itself, in one or two sentences.
    summary text,
    state text NOT NULL DEFAULT 'entwurf' CHECK (state IN ('entwurf', 'veroeffentlicht')),
    published_at timestamptz,
    published_by text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text
);

CREATE TABLE point_decisions (
    campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    map_point_id uuid NOT NULL REFERENCES map_points(id) ON DELETE CASCADE,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    outcome text NOT NULL CHECK (outcome IN ('uebernommen', 'abgefedert', 'zurueckgestellt', 'gutachten', 'nicht_beruecksichtigt')),
    reason text,
    decided_by text NOT NULL,
    decided_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (campaign_id, map_point_id)
);

-- (3) -------------------------------------------------------------------------------------------
CREATE TABLE campaign_followers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    email text NOT NULL,
    -- Tracking-slip tokens of the points this person sent (submissions.tracking_token).
    laufzettel text[] NOT NULL DEFAULT '{}',
    origin_hash text,
    created_at timestamptz NOT NULL DEFAULT now(),
    confirm_sent_at timestamptz,
    confirmed_at timestamptz,
    unsubscribed_at timestamptz,
    ergebnis_sent_at timestamptz,
    beschluss_sent_at timestamptz,
    UNIQUE (campaign_id, email)
);
CREATE INDEX campaign_followers_pending_idx ON campaign_followers (campaign_id) WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL;

ALTER TABLE campaign_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_campaign_decisions ON campaign_decisions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE point_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_point_decisions ON point_decisions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE campaign_followers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_campaign_followers ON campaign_followers
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_decisions, point_decisions, campaign_followers TO policy_app;
