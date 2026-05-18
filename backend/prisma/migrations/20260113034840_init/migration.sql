-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('SERVER', 'CLASSIC_SERVER', 'BLOCK_STORAGE', 'NAS', 'OBJECT_STORAGE', 'VPC', 'SUBNET', 'NAT_GATEWAY', 'LOAD_BALANCER', 'AUTO_SCALING', 'KUBERNETES', 'DATABASE', 'OTHER');

-- CreateEnum
CREATE TYPE "CleanupStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "billingPeriod" TEXT,
    "tags" TEXT[],
    "status" "CourseStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ncp_accounts" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "displayName" TEXT,
    "accessKeyEncrypted" TEXT NOT NULL,
    "secretKeyEncrypted" TEXT NOT NULL,
    "accessKeyHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ncp_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_accounts" (
    "id" TEXT NOT NULL,
    "ncpAccountId" TEXT NOT NULL,
    "subAccountId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sub_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" TEXT NOT NULL,
    "ncpAccountId" TEXT NOT NULL,
    "resourceType" "ResourceType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "resourceName" TEXT,
    "region" TEXT,
    "status" TEXT,
    "spec" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL,
    "ncpAccountId" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "usageDate" TIMESTAMP(3) NOT NULL,
    "usageQuantity" DOUBLE PRECISION NOT NULL,
    "usageUnit" TEXT,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_snapshots" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "accountCount" INTEGER NOT NULL,
    "breakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleanup_jobs" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "status" "CleanupStatus" NOT NULL DEFAULT 'PENDING',
    "isDryRun" BOOLEAN NOT NULL DEFAULT true,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cleanup_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleanup_logs" (
    "id" TEXT NOT NULL,
    "cleanupJobId" TEXT NOT NULL,
    "ncpAccountId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetName" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cleanup_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "courses_status_idx" ON "courses"("status");

-- CreateIndex
CREATE INDEX "courses_startDate_endDate_idx" ON "courses"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "ncp_accounts_courseId_idx" ON "ncp_accounts"("courseId");

-- CreateIndex
CREATE INDEX "ncp_accounts_accessKeyHash_idx" ON "ncp_accounts"("accessKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "ncp_accounts_courseId_accessKeyHash_key" ON "ncp_accounts"("courseId", "accessKeyHash");

-- CreateIndex
CREATE INDEX "sub_accounts_ncpAccountId_idx" ON "sub_accounts"("ncpAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sub_accounts_ncpAccountId_subAccountId_key" ON "sub_accounts"("ncpAccountId", "subAccountId");

-- CreateIndex
CREATE INDEX "resources_ncpAccountId_idx" ON "resources"("ncpAccountId");

-- CreateIndex
CREATE INDEX "resources_resourceType_idx" ON "resources"("resourceType");

-- CreateIndex
CREATE UNIQUE INDEX "resources_ncpAccountId_resourceType_resourceId_key" ON "resources"("ncpAccountId", "resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "usage_records_ncpAccountId_idx" ON "usage_records"("ncpAccountId");

-- CreateIndex
CREATE INDEX "usage_records_usageDate_idx" ON "usage_records"("usageDate");

-- CreateIndex
CREATE INDEX "usage_records_serviceCode_idx" ON "usage_records"("serviceCode");

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_ncpAccountId_serviceCode_usageDate_key" ON "usage_records"("ncpAccountId", "serviceCode", "usageDate");

-- CreateIndex
CREATE INDEX "cost_snapshots_courseId_idx" ON "cost_snapshots"("courseId");

-- CreateIndex
CREATE INDEX "cost_snapshots_periodStart_periodEnd_idx" ON "cost_snapshots"("periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "cleanup_jobs_courseId_idx" ON "cleanup_jobs"("courseId");

-- CreateIndex
CREATE INDEX "cleanup_jobs_status_idx" ON "cleanup_jobs"("status");

-- CreateIndex
CREATE INDEX "cleanup_logs_cleanupJobId_idx" ON "cleanup_logs"("cleanupJobId");

-- CreateIndex
CREATE INDEX "cleanup_logs_ncpAccountId_idx" ON "cleanup_logs"("ncpAccountId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "ncp_accounts" ADD CONSTRAINT "ncp_accounts_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_accounts" ADD CONSTRAINT "sub_accounts_ncpAccountId_fkey" FOREIGN KEY ("ncpAccountId") REFERENCES "ncp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_ncpAccountId_fkey" FOREIGN KEY ("ncpAccountId") REFERENCES "ncp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_ncpAccountId_fkey" FOREIGN KEY ("ncpAccountId") REFERENCES "ncp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_snapshots" ADD CONSTRAINT "cost_snapshots_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleanup_jobs" ADD CONSTRAINT "cleanup_jobs_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleanup_logs" ADD CONSTRAINT "cleanup_logs_cleanupJobId_fkey" FOREIGN KEY ("cleanupJobId") REFERENCES "cleanup_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleanup_logs" ADD CONSTRAINT "cleanup_logs_ncpAccountId_fkey" FOREIGN KEY ("ncpAccountId") REFERENCES "ncp_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
