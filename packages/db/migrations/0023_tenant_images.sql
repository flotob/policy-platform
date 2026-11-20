-- A municipality's public page (apps/beteiligung, streit.bar/<gemeinde>) as a profile: a title
-- photo across the top and a portrait beside the greeting. Text (one line under the name, the
-- greeting, links, opening hours, photo credit) lives in tenants.settings; the pictures live here,
-- one row per kind, so a 5 MB photo never rides along with the tenants row.
CREATE TABLE IF NOT EXISTS tenant_images (
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('titelbild', 'portrait')),
    bytes bytea NOT NULL,
    type text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, kind)
);

ALTER TABLE tenant_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenant_images ON tenant_images;
CREATE POLICY tenant_isolation_tenant_images ON tenant_images
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_images TO policy_app;
