-- Migration: Add PIN reset tracking fields for 6-digit PIN migration
-- Created: 2026-02-20

-- Add PIN reset tracking columns
ALTER TABLE "Hotel" ADD COLUMN IF NOT EXISTS "pinResetCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Hotel" ADD COLUMN IF NOT EXISTS "lastPinResetAt" TIMESTAMP(3);
ALTER TABLE "Hotel" ADD COLUMN IF NOT EXISTS "lastPinResetBy" TEXT;

-- Add comments for documentation
COMMENT ON COLUMN "Hotel"."pinResetCount" IS 'Total number of PIN resets performed';
COMMENT ON COLUMN "Hotel"."lastPinResetAt" IS 'Timestamp of last PIN reset';
COMMENT ON COLUMN "Hotel"."lastPinResetBy" IS 'Who performed the reset: super_admin | email_self | owner';

-- Verify columns were added
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'Hotel' 
AND column_name IN ('pinResetCount', 'lastPinResetAt', 'lastPinResetBy');