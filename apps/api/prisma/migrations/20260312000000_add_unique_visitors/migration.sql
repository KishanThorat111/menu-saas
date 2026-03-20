-- AlterTable: add uniqueCount to DailyScanLog
ALTER TABLE "DailyScanLog" ADD COLUMN "uniqueCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: DailyScanVisitor for unique visitor dedup
CREATE TABLE "DailyScanVisitor" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "visitorHash" CHAR(64) NOT NULL,

    CONSTRAINT "DailyScanVisitor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyScanVisitor_hotelId_date_idx" ON "DailyScanVisitor"("hotelId", "date");

-- CreateIndex
CREATE INDEX "DailyScanVisitor_date_idx" ON "DailyScanVisitor"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyScanVisitor_hotelId_date_visitorHash_key" ON "DailyScanVisitor"("hotelId", "date", "visitorHash");

-- AddForeignKey
ALTER TABLE "DailyScanVisitor" ADD CONSTRAINT "DailyScanVisitor_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
