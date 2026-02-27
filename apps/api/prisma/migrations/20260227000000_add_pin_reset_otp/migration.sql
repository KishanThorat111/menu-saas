-- CreateTable
CREATE TABLE "PinResetOtp" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "fingerprint" TEXT NOT NULL DEFAULT '',
    "used" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "resetTokenHash" TEXT,
    "resetExpiresAt" TIMESTAMP(3),
    "resetUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PinResetOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PinResetOtp_hotelId_used_expiresAt_idx" ON "PinResetOtp"("hotelId", "used", "expiresAt");

-- CreateIndex
CREATE INDEX "PinResetOtp_hotelId_createdAt_idx" ON "PinResetOtp"("hotelId", "createdAt");

-- AddForeignKey
ALTER TABLE "PinResetOtp" ADD CONSTRAINT "PinResetOtp_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
