-- What a municipality shows on its public pages (apps/beteiligung, /verwaltung/einstellungen):
-- contact, its own imprint and privacy notice (links to the town's website), and a logo.
-- settings = {"kontakt": {"stelle", "email", "telefon"}, "website", "impressum", "datenschutz"}.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo bytea;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_type text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_updated_at timestamptz;
