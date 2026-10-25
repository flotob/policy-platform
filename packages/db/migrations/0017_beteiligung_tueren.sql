-- Beteiligung, milestone 3: the three doors (Gesamtmodell B1–B14).
-- Citizens take part without an account: a pseudonymous participant per
-- campaign, identified by the hash of a random cookie token. Votes are tied
-- to the version of the statement they were cast on (A2): a changed
-- statement is voted on afresh, old votes stay with the old wording.

-- (1) Participants ----------------------------------------------------------

-- How the participant came in: tuer (door 1/2, cookie), datei (a statement
-- the town uploaded, E4), stellungnahme (door 3 from an organisation),
-- simulation (fictional demo only). NULL on federal consultations.
ALTER TABLE participants ADD COLUMN via text
    CHECK (via IN ('tuer', 'datei', 'stellungnahme', 'simulation'));
-- Salted hash of where a new participant came from — only to limit how many
-- pseudonyms one connection can open (B14); never shown, never joined to votes.
ALTER TABLE participants ADD COLUMN origin_hash text;
CREATE INDEX participants_origin_idx ON participants (consultation_id, origin_hash, created_at);

-- (2) Votes carry the statement's version ------------------------------------

ALTER TABLE map_point_votes ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE map_point_votes DROP CONSTRAINT map_point_votes_participant_id_map_point_id_key;
ALTER TABLE map_point_votes ADD CONSTRAINT map_point_votes_participant_point_version_key
    UNIQUE (participant_id, map_point_id, version);
CREATE INDEX map_point_votes_participant_idx ON map_point_votes (participant_id);

-- (3) Contributions from the doors --------------------------------------------

-- Who sent it (door 2/3) and the secret part of its tracking-slip link (B9).
ALTER TABLE submissions ADD COLUMN participant_id uuid REFERENCES participants(id);
ALTER TABLE submissions ADD COLUMN tracking_token text UNIQUE;
-- Door 3 uploads come from a participant, not from staff.
ALTER TABLE campaign_files ADD COLUMN participant_id uuid REFERENCES participants(id);

-- A short statement the participant sent to the editors (door 2, "Nein, das
-- ist etwas anderes"): the language model reads it in the background.
ALTER TABLE campaign_jobs ADD COLUMN submission_id uuid REFERENCES submissions(id) ON DELETE CASCADE;
ALTER TABLE campaign_jobs DROP CONSTRAINT campaign_jobs_kind_check;
ALTER TABLE campaign_jobs ADD CONSTRAINT campaign_jobs_kind_check CHECK (kind IN ('skelett', 'zerlegen', 'kurzaussage'));

-- (4) Invitation codes (access "einladung") ----------------------------------

-- One code, one participant. Only the hash is kept; the town prints the codes once.
CREATE TABLE campaign_invites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    code_hash text NOT NULL,
    participant_id uuid REFERENCES participants(id),
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (campaign_id, code_hash)
);

ALTER TABLE campaign_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_campaign_invites ON campaign_invites
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_invites TO policy_app;

-- (5) A door-2 point confirmed on the measure itself ("Ich bin für die
-- Solarpflicht") belongs to no step of the justification.
ALTER TABLE moves ALTER COLUMN schritt DROP NOT NULL;
ALTER TABLE moves ALTER COLUMN frage DROP NOT NULL;
ALTER TABLE moves ALTER COLUMN richtung DROP NOT NULL;
