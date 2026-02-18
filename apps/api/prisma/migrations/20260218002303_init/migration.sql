-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('STARTER', 'STANDARD', 'PRO');

-- CreateEnum
CREATE TYPE "HotelStatus" AS ENUM ('TRIAL', 'ACTIVE', 'GRACE', 'EXPIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('MANUAL', 'RAZORPAY', 'CASH');

-- CreateTable
CREATE TABLE "Hotel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "pinChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plan" "PlanType" NOT NULL DEFAULT 'STARTER',
    "status" "HotelStatus" NOT NULL DEFAULT 'TRIAL',
    "trialEnds" TIMESTAMP(3),
    "paidUntil" TIMESTAMP(3),
    "paymentMode" "PaymentMode" NOT NULL DEFAULT 'MANUAL',
    "lastPaymentDate" TIMESTAMP(3),
    "lastPaymentAmount" INTEGER,
    "lastPaymentNote" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'classic',
    "views" INTEGER NOT NULL DEFAULT 0,
    "lastViewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hotel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "isVeg" BOOLEAN NOT NULL DEFAULT false,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Hotel_tenantId_key" ON "Hotel"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Hotel_slug_key" ON "Hotel"("slug");

-- CreateIndex
CREATE INDEX "Hotel_city_status_idx" ON "Hotel"("city", "status");

-- CreateIndex
CREATE INDEX "Hotel_paidUntil_idx" ON "Hotel"("paidUntil");

-- CreateIndex
CREATE INDEX "Hotel_status_trialEnds_idx" ON "Hotel"("status", "trialEnds");

-- CreateIndex
CREATE INDEX "Category_hotelId_sortOrder_idx" ON "Category"("hotelId", "sortOrder");

-- CreateIndex
CREATE INDEX "Item_categoryId_sortOrder_idx" ON "Item"("categoryId", "sortOrder");

-- CreateIndex
CREATE INDEX "Item_categoryId_isAvailable_idx" ON "Item"("categoryId", "isAvailable");

-- CreateIndex
CREATE INDEX "AuditLog_hotelId_createdAt_idx" ON "AuditLog"("hotelId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
