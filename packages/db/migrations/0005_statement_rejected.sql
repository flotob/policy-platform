-- Align statement states with point states: the AI editor and the review
-- workbench use 'rejected'; 'retired' stays for superseded versions.
ALTER TABLE statements DROP CONSTRAINT statements_status_check;
ALTER TABLE statements ADD CONSTRAINT statements_status_check
    CHECK (status IN ('draft', 'released', 'retired', 'rejected'));
