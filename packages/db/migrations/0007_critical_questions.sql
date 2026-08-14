-- Iteration 2a: the five critical questions as an ORDERING layer.
--
-- cq: the door an OBJECTION point comes through (NULL for grammar claims
-- P1–P4/conclusion and for instruments). Vocabulary identical to the
-- point_edges attack kinds — the taxonomy was already canonical.
--
-- answers_cq: for instruments (kind='design'): which door(s) the
-- instrument answers. First element = primary door, rest secondary
-- (decision 2026-08-14). Array contents share the cq vocabulary;
-- validated in app code (PG CHECK on array elements needs a trigger,
-- not worth it at this stage).
ALTER TABLE points ADD COLUMN cq text
    CHECK (cq IN ('empirics', 'alternatives', 'goal_conflict',
                  'feasibility', 'value_conflict'));
ALTER TABLE points ADD COLUMN answers_cq text[];
