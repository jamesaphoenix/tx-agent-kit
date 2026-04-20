-- Assets domain: 5 tables, 3 enums, indexes, FKs
-- Spec: specs/design/assets-design.md

CREATE TYPE "asset_type" AS ENUM('image', 'video', 'audio', 'gif', 'document');
CREATE TYPE "processing_status" AS ENUM('pending', 'processing', 'completed', 'failed');
CREATE TYPE "pending_upload_status" AS ENUM('pending', 'confirmed', 'expired', 'failed');

-- team_media_assets: core asset record
CREATE TABLE "team_media_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL,
  "original_filename" text NOT NULL,
  "file_size" bigint NOT NULL,
  "mime_type" text NOT NULL,
  "asset_type" "asset_type" NOT NULL,
  "storage_path" text NOT NULL,
  "thumbnail_path" text,
  "ai_title" text,
  "ai_description" text,
  "ai_tags" text[] DEFAULT '{}'::text[] NOT NULL,
  "content_category" text,
  "emotion" jsonb,
  "purpose" text[] DEFAULT '{}'::text[] NOT NULL,
  "content_hash" text,
  "processing_status" "processing_status" DEFAULT 'pending'::"processing_status" NOT NULL,
  "processing_error" text,
  "embedding_generated_at" timestamp with time zone,
  "embedding_model" text,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "deleted_at" timestamp with time zone,
  "hard_deleted_at" timestamp with time zone,
  "shared_with_org" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- pending_uploads: two-phase upload confirmation
CREATE TABLE "pending_uploads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "declared_file_size" bigint NOT NULL,
  "content_hash" text,
  "mime_type" text NOT NULL,
  "storage_path" text NOT NULL,
  "presigned_url" text NOT NULL,
  "status" "pending_upload_status" DEFAULT 'pending'::"pending_upload_status" NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- storage_metering: per-org real-time byte counters
CREATE TABLE "storage_metering" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL UNIQUE,
  "active_bytes" bigint DEFAULT 0 NOT NULL,
  "soft_deleted_bytes" bigint DEFAULT 0 NOT NULL,
  "active_asset_count" integer DEFAULT 0 NOT NULL,
  "soft_deleted_asset_count" integer DEFAULT 0 NOT NULL,
  "measured_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- media_collections: named asset groupings
CREATE TABLE "media_collections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- collection_assets: M:N join table
CREATE TABLE "collection_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "collection_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Indexes: team_media_assets
CREATE INDEX "team_media_assets_team_id_is_deleted_idx" ON "team_media_assets" ("team_id", "is_deleted");
CREATE UNIQUE INDEX "team_media_assets_team_content_hash_unique" ON "team_media_assets" ("team_id", "content_hash") WHERE is_deleted = false AND content_hash IS NOT NULL;
CREATE INDEX "team_media_assets_team_created_at_idx" ON "team_media_assets" ("team_id", "created_at");
CREATE INDEX "team_media_assets_retention_scan_idx" ON "team_media_assets" ("deleted_at") WHERE is_deleted = true AND hard_deleted_at IS NULL;

-- Indexes: pending_uploads
CREATE INDEX "pending_uploads_team_id_idx" ON "pending_uploads" ("team_id");
CREATE INDEX "pending_uploads_status_expires_at_idx" ON "pending_uploads" ("status", "expires_at") WHERE "status" = 'pending';

-- Indexes: media_collections
CREATE INDEX "media_collections_team_id_idx" ON "media_collections" ("team_id");
CREATE INDEX "media_collections_team_name_idx" ON "media_collections" ("team_id", "name");

-- Indexes: collection_assets
CREATE UNIQUE INDEX "collection_assets_collection_asset_unique" ON "collection_assets" ("collection_id", "asset_id");
CREATE INDEX "collection_assets_asset_id_idx" ON "collection_assets" ("asset_id");

-- Foreign keys: team_media_assets
ALTER TABLE "team_media_assets" ADD CONSTRAINT "team_media_assets_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;

-- Foreign keys: pending_uploads
ALTER TABLE "pending_uploads" ADD CONSTRAINT "pending_uploads_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;
ALTER TABLE "pending_uploads" ADD CONSTRAINT "pending_uploads_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

-- Foreign keys: storage_metering
ALTER TABLE "storage_metering" ADD CONSTRAINT "storage_metering_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;

-- Foreign keys: media_collections
ALTER TABLE "media_collections" ADD CONSTRAINT "media_collections_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;

-- Foreign keys: collection_assets
ALTER TABLE "collection_assets" ADD CONSTRAINT "collection_assets_collection_id_media_collections_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "media_collections"("id") ON DELETE CASCADE;
ALTER TABLE "collection_assets" ADD CONSTRAINT "collection_assets_asset_id_team_media_assets_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "team_media_assets"("id") ON DELETE CASCADE;

-- updated_at trigger function (idempotent — only creates if not already defined)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    CREATE FUNCTION set_updated_at() RETURNS trigger AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON "team_media_assets" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "media_collections" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- CHECK constraints: non-negative sizes and counters
ALTER TABLE "team_media_assets" ADD CONSTRAINT "team_media_assets_file_size_non_negative" CHECK (file_size >= 0);
ALTER TABLE "pending_uploads" ADD CONSTRAINT "pending_uploads_declared_file_size_non_negative" CHECK (declared_file_size >= 0);
ALTER TABLE "storage_metering" ADD CONSTRAINT "storage_metering_active_bytes_non_negative" CHECK (active_bytes >= 0);
ALTER TABLE "storage_metering" ADD CONSTRAINT "storage_metering_soft_deleted_bytes_non_negative" CHECK (soft_deleted_bytes >= 0);
ALTER TABLE "storage_metering" ADD CONSTRAINT "storage_metering_active_asset_count_non_negative" CHECK (active_asset_count >= 0);
ALTER TABLE "storage_metering" ADD CONSTRAINT "storage_metering_soft_deleted_asset_count_non_negative" CHECK (soft_deleted_asset_count >= 0);
