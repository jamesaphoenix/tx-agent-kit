-- Phase 2: storage billing tables + asset metadata columns

-- New enum: asset_category
CREATE TYPE "asset_category" AS ENUM('user_upload', 'render', 'template', 'green_screen_template', 'sound_effect', 'music', 'brand_asset', 'other');

-- New columns on team_media_assets
ALTER TABLE "team_media_assets" ADD COLUMN "asset_category" "asset_category" NOT NULL DEFAULT 'user_upload';
ALTER TABLE "team_media_assets" ADD COLUMN "asset_type_data" jsonb;

-- New column on storage_metering
ALTER TABLE "storage_metering" ADD COLUMN "high_water_mark_bytes" bigint NOT NULL DEFAULT 0;

-- New table: daily_storage_snapshots
CREATE TABLE "daily_storage_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,
  "snapshot_date" text NOT NULL,
  "high_water_mark_bytes" bigint NOT NULL,
  "included_bytes" bigint NOT NULL,
  "overage_bytes" bigint NOT NULL DEFAULT 0,
  "overage_cost_decimillicents" bigint NOT NULL DEFAULT 0,
  "ledger_entry_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Indexes + constraints
CREATE UNIQUE INDEX "daily_storage_snapshots_org_date_unique" ON "daily_storage_snapshots" ("organization_id", "snapshot_date");
CREATE INDEX "daily_storage_snapshots_org_id_idx" ON "daily_storage_snapshots" ("organization_id");

-- Foreign keys
ALTER TABLE "daily_storage_snapshots" ADD CONSTRAINT "daily_storage_snapshots_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
ALTER TABLE "daily_storage_snapshots" ADD CONSTRAINT "daily_storage_snapshots_ledger_entry_id_credit_ledger_id_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "credit_ledger"("id");
