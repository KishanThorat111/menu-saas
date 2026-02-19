-- Migration to add missing columns to Hotel table
-- These fields exist in schema.prisma but were missing from init migration

-- Add email column for hotel owner contact
ALTER TABLE "Hotel" ADD COLUMN IF NOT EXISTS "email" TEXT;

-- Add consent tracking for DPDPA 2023 compliance
ALTER TABLE "Hotel" ADD COLUMN IF NOT EXISTS "consentedAt" TIMESTAMP(3);
ALTER TABLE "Hotel" ADD COLUMN IF NOT EXISTS "consentVersion" TEXT;

-- Add comment for documentation
COMMENT ON COLUMN "Hotel"."email" IS 'Hotel owner email for contact and notifications';
COMMENT ON COLUMN "Hotel"."consentedAt" IS 'Timestamp when owner consented to terms (DPDPA compliance)';
COMMENT ON COLUMN "Hotel"."consentVersion" IS 'Version of terms consented to';