-- Theme cluster (zoom level above single points), assigned by the theming
-- pipeline pass; NULL until the pass has run.
ALTER TABLE points ADD COLUMN theme text;
