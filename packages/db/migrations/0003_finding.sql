-- Editorial finding (Befund): the reviewer's synthesis shown on the map's
-- detail panel — separate from the machine-written summary.
ALTER TABLE points ADD COLUMN finding text;
