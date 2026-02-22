-- AlterEnum: Add DELETED to HotelStatus
ALTER TYPE "HotelStatus" ADD VALUE 'DELETED';

-- AlterTable: Add soft delete fields to Hotel
ALTER TABLE "Hotel" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Hotel" ADD COLUMN "deletedBy" TEXT;
ALTER TABLE "Hotel" ADD COLUMN "purgeAfter" TIMESTAMP(3);

-- CreateIndex: Efficient lookup for deleted hotels pending purge
CREATE INDEX "Hotel_status_deletedAt_idx" ON "Hotel"("status", "deletedAt");
