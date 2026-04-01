-- AlterTable
ALTER TABLE "TrialRequest" ADD COLUMN "consentedAt" TIMESTAMP(3),
ADD COLUMN "consentVersion" TEXT;
