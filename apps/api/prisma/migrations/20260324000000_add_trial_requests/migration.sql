-- CreateTable
CREATE TABLE "TrialRequest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "hotelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrialRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrialRequest_status_idx" ON "TrialRequest"("status");

-- CreateIndex
CREATE INDEX "TrialRequest_createdAt_idx" ON "TrialRequest"("createdAt");
