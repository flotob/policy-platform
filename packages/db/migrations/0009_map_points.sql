-- Verdichtungsschicht (decision 2026-09-15, back-to-the-paper round):
-- canonical LANDKARTEN-Punkte at map grain (~15-25 per measure), the unit
-- Stephan's prototype calls "Punkt". Extraction-grain points keep living in
-- `points` as the evidence layer underneath; each one links up via
-- points.map_point_id. Diagnosis vocabulary follows the prototype:
-- bruecke / klaerbar / offen / wert / kern / warnung / luecke.
CREATE TABLE map_points (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    consultation_id uuid NOT NULL REFERENCES consultations(id),
    -- Measure name or 'übergreifend': one Landkarte per scope.
    scope text NOT NULL,
    -- Display order within the scope (P01, P02, ... in reading order).
    ord integer NOT NULL DEFAULT 0,
    -- T = Tatsache, W = Wertung, verfahren = Ausgestaltung/Instrument,
    -- luecke = unanswered critical question (synthetic, deterministic).
    typ text NOT NULL CHECK (typ IN ('T', 'W', 'verfahren', 'luecke')),
    -- District on the map. Gutachter zone: wirkung/machbarkeit/kosten/
    -- alternativen; Rat zone: wert; below: ausgestaltung.
    bezirk text NOT NULL CHECK (bezirk IN
        ('wirkung', 'machbarkeit', 'kosten', 'alternativen', 'wert', 'ausgestaltung')),
    -- The canonical, votable sentence (one claim, neutral phrasing).
    text text NOT NULL,
    -- Short chip label for the map (<= 45 chars).
    label text NOT NULL,
    -- Deterministic diagnosis; 'warnung' only after the reasons check.
    diag text CHECK (diag IN
        ('bruecke', 'klaerbar', 'offen', 'wert', 'kern', 'warnung', 'luecke')),
    -- Camp agreement in percent (two largest camps); NULL = no vote data.
    pa integer,
    pb integer,
    -- Underlying voted extraction points that fed pa/pb.
    n_voted integer NOT NULL DEFAULT 0,
    -- Editorial finding: LLM-verbalized, deterministically bound (Phase-4
    -- rule: the machine may phrase the computed verdict, never change it).
    befund text,
    -- Machine flags needing editorial eyes, e.g. {"scheinbruecke": true}.
    diag_flags jsonb,
    -- [{lager, quelle, text}] original quotes pulled from point_sources.
    quotes jsonb,
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'released', 'rejected')),
    created_by text NOT NULL DEFAULT 'ai-condense',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (consultation_id, scope, ord)
);

-- Which canonical map point an extraction point condenses into.
ALTER TABLE points ADD COLUMN map_point_id uuid REFERENCES map_points(id);

-- RLS: same fail-closed pattern as everything else.
ALTER TABLE map_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_map_points ON map_points
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON map_points TO policy_app;
