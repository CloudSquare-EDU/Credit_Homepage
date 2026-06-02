-- AlterTable
ALTER TABLE "ncp_accounts" ADD COLUMN     "cumulativeCostUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "totalCumulativeCost" DOUBLE PRECISION;
