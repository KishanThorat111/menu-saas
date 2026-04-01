-- AlterTable: Payment.hotelId nullable + onDelete SetNull (preserve payment records for tax compliance)
-- Previously onDelete: Cascade would destroy payment records when a hotel was purged.
-- Indian GST/Income Tax requires payment records retained for 6+ years.

-- 1. Drop the existing foreign key constraint
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_hotelId_fkey";

-- 2. Make hotelId nullable
ALTER TABLE "Payment" ALTER COLUMN "hotelId" DROP NOT NULL;

-- 3. Re-add the foreign key with SET NULL on delete
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_hotelId_fkey"
    FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
