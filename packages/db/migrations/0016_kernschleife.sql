-- Beteiligung, milestone 2: the core loop (Stephan's Gesamtmodell Z1–Z10,
-- E2/E2b, A1–A3). One loop for every way text comes in (existing
-- statements, door 2, door 3): text → moves (Züge) with verbatim quotes →
-- fixed fields → known or new → routing → editorial decision → node.
--
-- Nodes (Knoten) are map_points: one node = one votable statement (I5), so
-- the vote matrix (map_point_votes), the camp math and the diagnoses work on
-- them unchanged. Ministry-app map points keep their columns; the new ones
-- are NULL there.

-- (1) Nodes ---------------------------------------------------------------

-- The old prototype's districts do not apply to a municipal procedure.
ALTER TABLE map_points ALTER COLUMN bezirk DROP NOT NULL;

-- schluss = the root "M tun" (also voted on, assumption 1); praemisse = a
-- claim from the town's own justification (start skeleton, E2); beitrag =
-- from a statement or a participant.
ALTER TABLE map_points ADD COLUMN rolle text
    CHECK (rolle IN ('schluss', 'praemisse', 'beitrag'));
-- The step of the justification the node supports or attacks (the artifact's
-- step model: Lage · Wirkung · Weg · Eingriff), the critical question it
-- raises or answers, and the direction. NULL on the root.
ALTER TABLE map_points ADD COLUMN schritt text
    CHECK (schritt IN ('lage', 'wirkung', 'weg', 'eingriff'));
ALTER TABLE map_points ADD COLUMN frage text
    CHECK (frage IN ('lage', 'wirkung', 'weg', 'nebenfolgen', 'wert'));
ALTER TABLE map_points ADD COLUMN richtung text
    CHECK (richtung IN ('stuetzt', 'greift_an'));
-- An attack in the words it was raised ("Das Handwerk schafft die Menge
-- nicht"), when the votable statement is phrased the other way round.
ALTER TABLE map_points ADD COLUMN einwand text;
-- What the machine proposed (text, label, typ, schritt, frage, richtung) —
-- kept next to what the editors released, so agreement stays measurable (Q1, I11).
ALTER TABLE map_points ADD COLUMN proposal jsonb;
-- The machine's recommendation for the editorial queue (release / reject /
-- review, with the criteria that failed).
ALTER TABLE map_points ADD COLUMN review jsonb;
-- Only a person (or, in AI mode, the machine named as such) releases (I1).
ALTER TABLE map_points ADD COLUMN released_by text;
ALTER TABLE map_points ADD COLUMN released_at timestamptz;
-- Deliberate merges only (I3): the editors fold a node into another.
ALTER TABLE map_points ADD COLUMN merged_into uuid REFERENCES map_points(id);
-- A change to a statement under vote creates a new version (A2); votes keep theirs.
ALTER TABLE map_points ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE map_points DROP CONSTRAINT map_points_status_check;
ALTER TABLE map_points ADD CONSTRAINT map_points_status_check
    CHECK (status IN ('draft', 'released', 'rejected', 'merged'));

-- (2) Moves (Züge) ---------------------------------------------------------

-- One claim in one statement, with the passage it comes from. A move without
-- a quote is invalid (I4): span_start/span_end point into submissions.text.
CREATE TABLE moves (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    consultation_id uuid NOT NULL REFERENCES consultations(id),
    submission_id uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    -- Reading order within the submission.
    ord integer NOT NULL,
    quote text NOT NULL,
    span_start integer NOT NULL,
    span_end integer NOT NULL,
    -- Z2: the claim with the tone stripped ("Ökodiktatur" → Eigentumsfreiheit).
    kern text NOT NULL,
    -- A1 proposal, used when the move opens a new node: votable sentence + chip label.
    aussage text NOT NULL,
    label text NOT NULL,
    -- Z3: fixed fields with finite domains (I2).
    typ text NOT NULL CHECK (typ IN ('T', 'W', 'verfahren')),
    schritt text NOT NULL CHECK (schritt IN ('lage', 'wirkung', 'weg', 'eingriff')),
    frage text NOT NULL CHECK (frage IN ('lage', 'wirkung', 'weg', 'nebenfolgen', 'wert')),
    richtung text NOT NULL CHECK (richtung IN ('stuetzt', 'greift_an')),
    einwand text,
    beleg text NOT NULL CHECK (beleg IN ('keine', 'behauptung', 'vergleichsfall', 'studie', 'messdaten')),
    -- Rule checks on the fields (e.g. a value claim on a fact step).
    flags text[] NOT NULL DEFAULT '{}',
    -- Z4: {outcome: treffer|gegenteil|praezisierung|neu, node, pSame, pOpposite, pRelated, pick, shortlist}
    match jsonb,
    -- Z5: auto = attached without a person; the others went to the editors.
    route text CHECK (route IN ('auto', 'unsicher', 'gegenteil', 'praezisierung', 'neu')),
    -- Z9: an automatic attachment drawn for a spot check.
    sample boolean NOT NULL DEFAULT false,
    -- vorgelegt = waiting for a decision; verknuepft = belongs to its node; verworfen = no argument.
    state text NOT NULL DEFAULT 'vorgelegt' CHECK (state IN ('vorgelegt', 'verknuepft', 'verworfen')),
    -- The node it belongs to (or is proposed for), and whether it agrees with
    -- the node's statement (+1) or contradicts it (-1) — the inferred vote of
    -- door 3 (assumption 3).
    map_point_id uuid REFERENCES map_points(id),
    stance smallint NOT NULL DEFAULT 1 CHECK (stance IN (-1, 1)),
    decided_by text,
    decided_at timestamptz,
    -- What was decided, next to what the machine proposed (Q1).
    decision jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (submission_id, ord)
);
CREATE INDEX moves_consultation_idx ON moves (consultation_id, state);
CREATE INDEX moves_map_point_idx ON moves (map_point_id);

-- (3) Background work ------------------------------------------------------

-- The machine's work for a campaign, done one job at a time by the app's
-- worker: the start skeleton (E2) and one decomposition per statement (Z1–Z5).
CREATE TABLE campaign_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('skelett', 'zerlegen')),
    -- zerlegen: the campaign file to read.
    file_id uuid REFERENCES campaign_files(id) ON DELETE CASCADE,
    state text NOT NULL DEFAULT 'wartet' CHECK (state IN ('wartet', 'laeuft', 'fertig', 'fehler')),
    attempts integer NOT NULL DEFAULT 0,
    -- What the job found (moves, new nodes, quotes not found, …) or why it failed.
    result jsonb,
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz
);
CREATE INDEX campaign_jobs_queue_idx ON campaign_jobs (state, created_at);

-- An uploaded statement becomes a submission once its text is extracted (Z1).
ALTER TABLE campaign_files ADD COLUMN submission_id uuid REFERENCES submissions(id) ON DELETE SET NULL;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['moves', 'campaign_jobs'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%I ON %I
                USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)
                WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
            t, t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO policy_app', t);
    END LOOP;
END $$;
