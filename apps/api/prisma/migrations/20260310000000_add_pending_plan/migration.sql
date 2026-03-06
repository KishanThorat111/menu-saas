-- AlterTable
ALTER TABLE "Hotel" ADD COLUMN "pendingPlan" "PlanType",
ADD COLUMN "pendingPlanPaid" BOOLEAN NOT NULL DEFAULT false;
