-- Per-vote provenance: real (questionnaire mapping, platform voting) vs.
-- inferred (LLM stance judgment from free text). Required before one
-- participant can carry both kinds in a single matrix.
ALTER TABLE votes ADD COLUMN method text NOT NULL DEFAULT 'real'
    CHECK (method IN ('real', 'inferred'));

-- Backfill: every vote cast by an inferred participant was inferred.
UPDATE votes SET method = 'inferred'
WHERE participant_id IN (
    SELECT id FROM participants WHERE source_ref LIKE 'inferred:%'
);
