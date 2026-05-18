-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "cumulativeCostUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "totalCumulativeCost" DOUBLE PRECISION;
