-- Maßnahmen-Zuschnitt (decision 2026-08-14): one chain per measure, the AI
-- determines the segmentation. Lightweight like points.theme: the measure
-- label lives on the point; 'übergreifend' marks cross-cutting points that
-- belong to every measure's chain (the shared trunk). NULL = not yet
-- segmented.
ALTER TABLE points ADD COLUMN measure text;
