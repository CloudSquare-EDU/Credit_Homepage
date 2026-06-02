-- AlterTable
ALTER TABLE "ncp_accounts" ADD COLUMN     "creditData" JSONB,
ADD COLUMN     "creditUpdatedAt" TIMESTAMP(3);
