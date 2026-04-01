-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_hotelId_fkey";

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "hotelId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
