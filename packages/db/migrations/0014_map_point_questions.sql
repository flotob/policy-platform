-- exp/jev: Landkarten-Punkte stand for one disputed QUESTION (condense v2).

-- (1) The open question a Landkarten-Punkt answers ("Wie streng sollen die
-- Biomasse-Grenzen sein?"); its text is one answer to it, votable yes/no.
-- NULL on map points condensed before v2.
ALTER TABLE map_points ADD COLUMN question text;

-- (2) 'gestaltung': the camps split on a design point (deadline, threshold,
-- exemption, procedure) — neither a fact a study settles nor a pure value
-- question. Before, such splits fell back to 'offen' ("Evidenz fehlt").
ALTER TABLE map_points DROP CONSTRAINT map_points_diag_check;
ALTER TABLE map_points ADD CONSTRAINT map_points_diag_check
    CHECK (diag = ANY (ARRAY['bruecke', 'klaerbar', 'offen', 'wert', 'kern', 'warnung', 'luecke', 'gestaltung']));
