-- exp/jev: a window plan belongs to one version of the submission text and
-- one cut policy. Without this, a re-imported (changed) text would reuse
-- cuts that no longer fit — an appended section would never be extracted.
ALTER TABLE window_plans ADD COLUMN text_hash text;
