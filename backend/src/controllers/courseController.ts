/**
 * 과정 관리 컨트롤러
 */

import { Response, NextFunction } from 'express';
import { PrismaClient, CourseStatus } from '@prisma/client';
import { AuthRequest } from '../middlewares/auth';
import { createAuditLog, extractAuditInfo } from '../middlewares/audit';
import { AppError } from '../middlewares/errorHandler';
import { config } from '../config';
import { decrypt } from '../utils/encryption';
import { NcpClient } from '../services/ncp';
import logger from '../utils/logger';

const prisma = new PrismaClient();

/**
 * 날짜 기준으로 과정 상태를 자동 계산 (ARCHIVED는 수동 유지)
 */
function computeEffectiveStatus(status: CourseStatus, startDate: Date, endDate: Date): CourseStatus {
  if (status === CourseStatus.ARCHIVED) return CourseStatus.ARCHIVED;
  const now = new Date();
  if (now < startDate) return CourseStatus.DRAFT;
  if (now > endDate) return CourseStatus.COMPLETED;
  return CourseStatus.ACTIVE;
}

/**
 * 과정 생성
 */
export const createCourse = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name, description, startDate, endDate, billingPeriod, tags, budgetAmount, budgetRatio } = req.body;

    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      throw new AppError('종료일은 시작일보다 이후여야 합니다', 400);
    }

    if (budgetAmount !== undefined && budgetAmount !== null && Number(budgetAmount) < 0) {
      throw new AppError('예산 금액은 0 이상이어야 합니다', 400);
    }
    if (budgetRatio !== undefined && budgetRatio !== null) {
      const ratio = Number(budgetRatio);
      if (ratio < 0 || ratio > 100) {
        throw new AppError('할당 비율은 0~100 사이여야 합니다', 400);
      }
    }

    const course = await prisma.course.create({
      data: {
        name,
        description,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        billingPeriod,
        tags: tags || [],
        status: CourseStatus.DRAFT,
        budgetAmount: budgetAmount !== undefined ? Number(budgetAmount) : null,
        budgetRatio: budgetRatio !== undefined ? Number(budgetRatio) : null
      }
    });

    // 감사 로그
    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'COURSE_CREATE',
      entityType: 'Course',
      entityId: course.id,
      newValue: { name, startDate, endDate }
    });

    res.status(201).json({
      success: true,
      data: course
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 과정 목록 조회
 */
export const listCourses = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { status, search, page = 1, limit = config.pagination.defaultLimit } = req.query;

    const where: Record<string, unknown> = {};

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where,
        include: {
          _count: {
            select: { accounts: true }
          },
          costSnapshots: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { totalCost: true, createdAt: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit)
      }),
      prisma.course.count({ where })
    ]);

    // 날짜 기준 상태 자동 보정 (ARCHIVED 제외) — 변경된 것만 DB 업데이트 (non-blocking)
    const statusUpdates: { id: string; status: CourseStatus }[] = [];
    const coursesWithStatus = courses.map(course => {
      const effective = computeEffectiveStatus(course.status, course.startDate, course.endDate);
      if (effective !== course.status) {
        statusUpdates.push({ id: course.id, status: effective });
        return { ...course, status: effective };
      }
      return course;
    });

    if (statusUpdates.length > 0) {
      Promise.all(
        statusUpdates.map(u => prisma.course.update({ where: { id: u.id }, data: { status: u.status } }))
      ).catch(err => logger.error('Status auto-update failed:', err));
    }

    res.json({
      success: true,
      data: coursesWithStatus,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 과정 상세 조회
 */
export const getCourse = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        accounts: {
          select: {
            id: true,
            displayName: true,
            accessKeyHash: true,
            isActive: true,
            isMaster: true,
            ncpMemberNo: true,
            lastSyncAt: true,
            createdAt: true,
            _count: {
              select: { resources: true, subAccounts: true }
            }
          }
        },
        _count: {
          select: { accounts: true, costSnapshots: true }
        }
      }
    });

    if (!course) {
      throw new AppError('Course not found', 404);
    }

    // 날짜 기준 상태 자동 보정 (ARCHIVED 제외)
    const effective = computeEffectiveStatus(course.status, course.startDate, course.endDate);
    if (effective !== course.status) {
      prisma.course.update({ where: { id: course.id }, data: { status: effective } })
        .catch(err => logger.error('Status auto-update failed:', err));
    }

    res.json({
      success: true,
      data: { ...course, status: effective }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 과정 수정
 */
export const updateCourse = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;
    const { name, description, startDate, endDate, billingPeriod, tags, status, budgetAmount, budgetRatio } = req.body;

    const existingCourse = await prisma.course.findUnique({
      where: { id: courseId }
    });

    if (!existingCourse) {
      throw new AppError('Course not found', 404);
    }

    const resolvedStart = startDate ? new Date(startDate) : existingCourse.startDate;
    const resolvedEnd = endDate ? new Date(endDate) : existingCourse.endDate;
    if (resolvedEnd < resolvedStart) {
      throw new AppError('종료일은 시작일보다 이후여야 합니다', 400);
    }

    if (budgetAmount !== undefined && budgetAmount !== null && Number(budgetAmount) < 0) {
      throw new AppError('예산 금액은 0 이상이어야 합니다', 400);
    }
    if (budgetRatio !== undefined && budgetRatio !== null) {
      const ratio = Number(budgetRatio);
      if (ratio < 0 || ratio > 100) {
        throw new AppError('할당 비율은 0~100 사이여야 합니다', 400);
      }
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (startDate !== undefined) updateData.startDate = new Date(startDate);
    if (endDate !== undefined) updateData.endDate = new Date(endDate);
    if (billingPeriod !== undefined) updateData.billingPeriod = billingPeriod;
    if (tags !== undefined) updateData.tags = tags;
    if (status !== undefined) updateData.status = status;
    if (budgetAmount !== undefined) updateData.budgetAmount = budgetAmount === null ? null : Number(budgetAmount);
    if (budgetRatio !== undefined) updateData.budgetRatio = budgetRatio === null ? null : Number(budgetRatio);

    const course = await prisma.course.update({
      where: { id: courseId },
      data: updateData
    });

    // 감사 로그
    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'COURSE_UPDATE',
      entityType: 'Course',
      entityId: courseId,
      oldValue: existingCourse,
      newValue: updateData
    });

    res.json({
      success: true,
      data: course
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 과정 삭제
 */
export const deleteCourse = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;

    const course = await prisma.course.findUnique({
      where: { id: courseId }
    });

    if (!course) {
      throw new AppError('Course not found', 404);
    }

    await prisma.course.delete({
      where: { id: courseId }
    });

    // 감사 로그
    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'COURSE_DELETE',
      entityType: 'Course',
      entityId: courseId,
      oldValue: { name: course.name }
    });

    res.json({
      success: true,
      message: 'Course deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 과정 상태 변경
 */
export const updateCourseStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;
    const { status } = req.body;

    const course = await prisma.course.findUnique({
      where: { id: courseId }
    });

    if (!course) {
      throw new AppError('Course not found', 404);
    }

    const oldStatus = course.status;

    const updatedCourse = await prisma.course.update({
      where: { id: courseId },
      data: { status }
    });

    // 감사 로그
    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'COURSE_STATUS_CHANGE',
      entityType: 'Course',
      entityId: courseId,
      oldValue: { status: oldStatus },
      newValue: { status }
    });

    res.json({
      success: true,
      data: updatedCourse
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 과정 통계
 */
export const getCourseStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const [total, byStatus, upcoming, active] = await Promise.all([
      prisma.course.count(),
      prisma.course.groupBy({
        by: ['status'],
        _count: true
      }),
      prisma.course.count({
        where: {
          startDate: { gt: new Date() }
        }
      }),
      prisma.course.count({
        where: {
          status: CourseStatus.ACTIVE,
          startDate: { lte: new Date() },
          endDate: { gte: new Date() }
        }
      })
    ]);

    const statusMap = byStatus.reduce((acc, item) => {
      acc[item.status] = item._count;
      return acc;
    }, {} as Record<string, number>);

    res.json({
      success: true,
      data: {
        total,
        byStatus: statusMap,
        upcoming,
        active
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 과정 전체 동기화 (서브계정 + 리소스 + 비용 일괄 조회)
 * 백엔드에서 병렬 처리하여 프론트엔드보다 훨씬 빠름
 */
export const syncAllAccounts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;
    const BATCH_SIZE = 10; // 백엔드에서는 더 큰 배치 가능

    // 과정의 모든 계정 조회
    const accounts = await prisma.ncpAccount.findMany({
      where: { courseId },
      select: {
        id: true,
        displayName: true,
        accessKeyEncrypted: true,
        secretKeyEncrypted: true,
        accessKeyHash: true,
        isMaster: true
      }
    });

    if (accounts.length === 0) {
      res.json({
        success: true,
        data: {
          total: 0,
          results: [],
          summary: {
            totalSubAccounts: 0,
            totalResources: 0,
            totalCost: 0,
            accountsWithResources: 0
          }
        }
      });
      return;
    }

    interface AccountSyncResult {
      accountId: string;
      accountName: string;
      success: boolean;
      subAccountCount: number;
      resources: Record<string, number>;
      totalResourceCount: number;
      totalCost: number;
      totalUseAmount: number;
      error?: string;
    }

    const results: AccountSyncResult[] = [];

    // 배치 단위로 병렬 처리
    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
      const batch = accounts.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(async (account) => {
          const accessKey = decrypt(account.accessKeyEncrypted);
          const secretKey = decrypt(account.secretKeyEncrypted);
          const ncpClient = new NcpClient({ accessKey, secretKey });

          // 서브계정, 리소스, 비용을 동시에 조회
          const [subAccResult, resourcesResult, costResult] = await Promise.allSettled([
            ncpClient.subAccount.getSubAccounts(),
            ncpClient.getAllResources(),
            ncpClient.billing.getCurrentMonthCost(account.isMaster ? true : undefined)
          ]);

          // 서브계정 수
          let subAccountCount = 0;
          if (subAccResult.status === 'fulfilled' && subAccResult.value.success) {
            subAccountCount = subAccResult.value.accounts.length;

            // DB에 서브계정 정보 동기화
            for (const sub of subAccResult.value.accounts) {
              const displayName = sub.subAccountName || sub.subAccountLoginId || sub.subAccountId;
              await prisma.subAccount.upsert({
                where: {
                  ncpAccountId_subAccountId: {
                    ncpAccountId: account.id,
                    subAccountId: sub.subAccountId
                  }
                },
                update: { name: displayName, email: sub.email },
                create: {
                  ncpAccountId: account.id,
                  subAccountId: sub.subAccountId,
                  name: displayName,
                  email: sub.email
                }
              });
            }
          }

          // 리소스 집계
          const resources: Record<string, number> = {};
          let totalResourceCount = 0;
          if (resourcesResult.status === 'fulfilled') {
            const data = resourcesResult.value;
            if (data.servers?.count > 0) resources.servers = data.servers.count;
            if (data.vpcs?.count > 0) resources.vpcs = data.vpcs.count;
            if (data.subnets?.count > 0) resources.subnets = data.subnets.count;
            if (data.natGateways?.count > 0) resources.natGateways = data.natGateways.count;
            if (data.blockStorages?.count > 0) resources.blockStorages = data.blockStorages.count;
            if (data.nasVolumes?.count > 0) resources.nasVolumes = data.nasVolumes.count;
            if (data.loadBalancers?.count > 0) resources.loadBalancers = data.loadBalancers.count;
            if (data.targetGroups?.count > 0) resources.targetGroups = data.targetGroups.count;
            totalResourceCount = Object.values(resources).reduce((sum, c) => sum + c, 0);
          }

          // 비용 (invoiceDemandAmount = 이용 요금 절사 후, VAT 전)
          let totalCost = 0;
          let totalUseAmount = 0;
          if (costResult.status === 'fulfilled' && costResult.value.success) {
            totalCost = costResult.value.invoiceDemandAmount ?? costResult.value.totalDemandAmount ?? 0;
            totalUseAmount = costResult.value.invoiceUseAmount ?? costResult.value.totalUseAmount ?? 0;
          }

          // 마지막 동기화 시간 업데이트
          await prisma.ncpAccount.update({
            where: { id: account.id },
            data: { lastSyncAt: new Date() }
          });

          return {
            accountId: account.id,
            accountName: account.displayName || account.accessKeyHash?.substring(0, 12) || account.id,
            success: true,
            subAccountCount,
            resources,
            totalResourceCount,
            totalCost,
            totalUseAmount
          };
        })
      );

      // 결과 처리
      batchResults.forEach((result, idx) => {
        const account = batch[idx];
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            accountId: account.id,
            accountName: account.displayName || account.accessKeyHash?.substring(0, 12) || account.id,
            success: false,
            subAccountCount: 0,
            resources: {},
            totalResourceCount: 0,
            totalCost: 0,
            totalUseAmount: 0,
            error: result.reason?.message || '알 수 없는 오류'
          });
        }
      });
    }

    // 요약 통계 계산
    // 마스터 계정이 있으면 그 계정의 비용이 이미 전체 조직 합계이므로, 이중 집계 방지를 위해
    // 마스터 계정의 결과만 totalCost로 사용하고 나머지는 합산하지 않음
    const masterResult = accounts.find(a => a.isMaster)
      ? results.find(r => accounts.find(a => a.id === r.accountId && a.isMaster))
      : null;

    const courseTotalCost = masterResult
      ? masterResult.totalCost
      : results.reduce((sum, r) => sum + r.totalCost, 0);
    const courseTotalUseAmount = masterResult
      ? masterResult.totalUseAmount
      : results.reduce((sum, r) => sum + r.totalUseAmount, 0);

    const summary = {
      totalSubAccounts: results.reduce((sum, r) => sum + r.subAccountCount, 0),
      totalResources: results.reduce((sum, r) => sum + r.totalResourceCount, 0),
      totalCost: courseTotalCost,
      totalUseAmount: courseTotalUseAmount,
      accountsWithResources: results.filter(r => r.totalResourceCount > 0).length,
      successCount: results.filter(r => r.success).length,
      failCount: results.filter(r => !r.success).length,
      hasMasterAccount: !!masterResult
    };

    // 동기화 결과 costSnapshot 자동 저장 (비용이 0원 이상인 경우)
    const totalSyncCost = summary.totalUseAmount || summary.totalCost;
    if (totalSyncCost >= 0) {
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      await prisma.costSnapshot.create({
        data: {
          courseId,
          periodStart,
          periodEnd,
          totalCost: totalSyncCost,
          accountCount: accounts.length,
          breakdown: {
            byAccount: results.map(r => ({
              accountId: r.accountId,
              accountName: r.accountName,
              cost: r.totalUseAmount || r.totalCost
            }))
          }
        }
      });
    }

    // 감사 로그
    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'COURSE_SYNC_ALL',
      entityType: 'Course',
      entityId: courseId,
      newValue: { accounts: accounts.length, ...summary }
    });

    res.json({
      success: true,
      data: {
        total: accounts.length,
        results,
        summary
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 선택된 계정들의 리소스 일괄 삭제
 * 서버, 로드밸런서, NAT Gateway, 서브계정 순서로 삭제
 */
export const bulkCleanupResources = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;
    const { accountIds, isDryRun = true } = req.body;

    if (!Array.isArray(accountIds) || accountIds.length === 0) {
      throw new AppError('accountIds must be a non-empty array', 400);
    }

    // 선택된 계정들 조회
    const accounts = await prisma.ncpAccount.findMany({
      where: {
        courseId,
        id: { in: accountIds },
        isActive: true
      },
      select: {
        id: true,
        displayName: true,
        accessKeyEncrypted: true,
        secretKeyEncrypted: true,
        accessKeyHash: true
      }
    });

    if (accounts.length === 0) {
      res.json({
        success: true,
        data: {
          total: 0,
          results: [],
          summary: { totalActions: 0, successActions: 0, failedActions: 0 }
        }
      });
      return;
    }

    interface CleanupAction {
      type: string;
      targetId: string;
      targetName?: string;
      status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'MANUAL_REQUIRED';
      error?: string;
    }

    interface AccountCleanupResult {
      accountId: string;
      accountName: string;
      success: boolean;
      actions: CleanupAction[];
      error?: string;
    }

    const results: AccountCleanupResult[] = [];

    // ── 서버 상태 폴링 헬퍼 ──────────────────────────────────────────
    // 서버가 STOPPED 상태가 될 때까지 폴링 (최대 maxMs ms)
    const pollUntilStopped = async (ncpClient: NcpClient, serverNo: string, maxMs = 120000): Promise<boolean> => {
      const t0 = Date.now();
      while (Date.now() - t0 < maxMs) {
        const list = await ncpClient.server.getVpcServers();
        const s = list.servers.find(sv => sv.serverInstanceNo === serverNo);
        if (!s) return true;
        const code = s.serverInstanceStatus.code;
        if (code === 'STOPPED' || code === 'TERMINATING' || code === 'TERMINATED') return true;
        logger.info(`[POLL] Server ${serverNo} status=${code}, waiting 5s...`);
        await new Promise(r => setTimeout(r, 5000));
      }
      return false;
    };

    // 지정한 서버들이 목록에서 사라질 때까지 폴링 (최대 maxMs ms)
    const pollUntilTerminated = async (ncpClient: NcpClient, serverNos: string[], maxMs = 300000): Promise<void> => {
      const t0 = Date.now();
      let remaining = [...serverNos];
      while (remaining.length > 0 && Date.now() - t0 < maxMs) {
        await new Promise(r => setTimeout(r, 10000));
        const list = await ncpClient.server.getVpcServers();
        const activeNos = new Set(list.servers.map(sv => sv.serverInstanceNo));
        remaining = remaining.filter(id => activeNos.has(id));
        if (remaining.length > 0) logger.info(`[POLL] Waiting for ${remaining.length} server(s) to be fully terminated...`);
      }
    };
    // ────────────────────────────────────────────────────────────────

    // 각 계정별로 순차 처리
    for (const account of accounts) {
      const accountResult: AccountCleanupResult = {
        accountId: account.id,
        accountName: account.displayName || account.accessKeyHash?.substring(0, 12) || account.id,
        success: true,
        actions: []
      };

      try {
        const accessKey = decrypt(account.accessKeyEncrypted);
        const secretKey = decrypt(account.secretKeyEncrypted);
        const ncpClient = new NcpClient({ accessKey, secretKey });

        // 0. NKS 클러스터 삭제
        const clusters = await ncpClient.nks.getClusters();
        const totalClusters = clusters.clusters?.length || 0;
        logger.info(`[NKS] Found ${totalClusters} clusters`);
        let clusterIndex = 0;
        for (const cluster of clusters.clusters || []) {
          clusterIndex++;
          if (isDryRun) {
            accountResult.actions.push({ type: 'DELETE_NKS_CLUSTER', targetId: cluster.uuid, targetName: cluster.name, status: 'SKIPPED' });
          } else {
            const result = await ncpClient.nks.deleteCluster(cluster.uuid);
            accountResult.actions.push({ type: 'DELETE_NKS_CLUSTER', targetId: cluster.uuid, targetName: cluster.name, status: result.success ? 'SUCCESS' : 'FAILED', error: result.error });
            if (result.success) { logger.info(`[NKS ${clusterIndex}/${totalClusters}] ✓ ${cluster.name} deletion initiated (10s wait)`); await new Promise(r => setTimeout(r, 10000)); }
            else logger.error(`[NKS ${clusterIndex}/${totalClusters}] ✗ ${cluster.name}: ${result.error}`);
          }
          await new Promise(r => setTimeout(r, 500));
        }

        // 0-1. Auto Scaling Group 삭제
        const asgGroups = await ncpClient.autoScaling.getAutoScalingGroups();
        const totalAsgs = asgGroups.groups?.length || 0;
        logger.info(`[ASG] Found ${totalAsgs} groups`);
        let asgIndex = 0;
        for (const group of asgGroups.groups || []) {
          asgIndex++;
          if (isDryRun) {
            accountResult.actions.push({ type: 'DELETE_ASG', targetId: group.autoScalingGroupNo, targetName: group.autoScalingGroupName, status: 'SKIPPED' });
          } else {
            const result = await ncpClient.autoScaling.deleteAutoScalingGroup(group.autoScalingGroupNo);
            accountResult.actions.push({ type: 'DELETE_ASG', targetId: group.autoScalingGroupNo, targetName: group.autoScalingGroupName, status: result.success ? 'SUCCESS' : 'FAILED', error: result.error });
            if (result.success) { logger.info(`[ASG ${asgIndex}/${totalAsgs}] ✓ ${group.autoScalingGroupName} deletion initiated (5s wait)`); await new Promise(r => setTimeout(r, 5000)); }
            else logger.error(`[ASG ${asgIndex}/${totalAsgs}] ✗ ${group.autoScalingGroupName}: ${result.error}`);
          }
          await new Promise(r => setTimeout(r, 500));
        }

        // 1. 로드밸런서 삭제 (서버 삭제보다 먼저)
        const lbs = await ncpClient.loadBalancer.getLoadBalancerList();
        const totalLbs = lbs.loadBalancers.length;
        logger.info(`[LOAD_BALANCER] Found ${totalLbs} load balancers`);
        let lbIndex = 0;
        for (const lb of lbs.loadBalancers) {
          lbIndex++;
          if (isDryRun) {
            accountResult.actions.push({ type: 'DELETE_LOAD_BALANCER', targetId: lb.loadBalancerInstanceNo, targetName: lb.loadBalancerName, status: 'SKIPPED' });
          } else {
            let lbResult, lbRetry = 0;
            while (lbRetry < 3) { lbResult = await ncpClient.loadBalancer.deleteLoadBalancer(lb.loadBalancerInstanceNo); if (lbResult.success) break; lbRetry++; if (lbRetry < 3) await new Promise(r => setTimeout(r, 2000 * lbRetry)); }
            accountResult.actions.push({ type: 'DELETE_LOAD_BALANCER', targetId: lb.loadBalancerInstanceNo, targetName: lb.loadBalancerName, status: lbResult.success ? 'SUCCESS' : 'FAILED', error: lbResult.error });
            if (lbResult.success) logger.info(`[LOAD_BALANCER ${lbIndex}/${totalLbs}] ✓ ${lb.loadBalancerName} deleted`);
            else logger.error(`[LOAD_BALANCER ${lbIndex}/${totalLbs}] ✗ ${lb.loadBalancerName}: ${lbResult.error}`);
          }
          await new Promise(r => setTimeout(r, 500));
        }

        // 1-1. Target Group 삭제 (LB 삭제 후 반드시 처리 — Subnet 삭제에 필요)
        if (totalLbs > 0 && !isDryRun) await new Promise(r => setTimeout(r, 3000));
        const targetGroups = await ncpClient.loadBalancer.getTargetGroupList();
        const totalTgs = targetGroups.targetGroups.length;
        logger.info(`[TARGET_GROUP] Found ${totalTgs} target groups`);
        let tgIndex = 0;
        for (const tg of targetGroups.targetGroups) {
          tgIndex++;
          if (isDryRun) {
            accountResult.actions.push({ type: 'DELETE_TARGET_GROUP', targetId: tg.targetGroupNo, targetName: tg.targetGroupName, status: 'SKIPPED' });
          } else {
            const tgResult = await ncpClient.loadBalancer.deleteTargetGroup(tg.targetGroupNo);
            accountResult.actions.push({ type: 'DELETE_TARGET_GROUP', targetId: tg.targetGroupNo, targetName: tg.targetGroupName, status: tgResult.success ? 'SUCCESS' : 'FAILED', error: tgResult.error });
            if (tgResult.success) logger.info(`[TARGET_GROUP ${tgIndex}/${totalTgs}] ✓ ${tg.targetGroupName} deleted`);
            else logger.error(`[TARGET_GROUP ${tgIndex}/${totalTgs}] ✗ ${tg.targetGroupName}: ${tgResult.error}`);
          }
          await new Promise(r => setTimeout(r, 500));
        }

        // 2. Cloud Functions 삭제
        const cloudFunctions = await ncpClient.cloudFunction.getFunctions();
        const totalFunctions = cloudFunctions.functions.length;
        logger.info(`[CLOUD_FUNCTION] Found ${totalFunctions} cloud functions`);
        let functionIndex = 0;
        for (const func of cloudFunctions.functions) {
          functionIndex++;
          if (isDryRun) {
            accountResult.actions.push({ type: 'DELETE_CLOUD_FUNCTION', targetId: func.functionId, targetName: func.functionName, status: 'SKIPPED' });
          } else {
            const result = await ncpClient.cloudFunction.deleteFunction(func.functionId);
            accountResult.actions.push({ type: 'DELETE_CLOUD_FUNCTION', targetId: func.functionId, targetName: func.functionName, status: result.success ? 'SUCCESS' : 'FAILED', error: result.error });
            if (result.success) logger.info(`[CLOUD_FUNCTION ${functionIndex}/${totalFunctions}] ✓ ${func.functionName} deleted`);
            else logger.error(`[CLOUD_FUNCTION ${functionIndex}/${totalFunctions}] ✗ ${func.functionName}: ${result.error}`);
          }
          await new Promise(r => setTimeout(r, 500));
        }

        // 3. 서버 삭제 (반납 보호 해제 → Public IP 분리 → 블록 스토리지 분리/삭제 → 정지 폴링 → 반납)
        const servers = await ncpClient.server.getVpcServers();
        const totalServers = servers.servers.length;
        logger.info(`[SERVER] Found ${totalServers} servers`);
        const terminatedServerNos: string[] = [];

        let serverIndex = 0;
        for (const server of servers.servers) {
          serverIndex++;
          const isNksNode = server.serverName.includes('-nks-node-');
          const isAsgServer = server.serverName.includes('-asg-');
          if (isNksNode || isAsgServer) {
            logger.info(`[SERVER ${serverIndex}/${totalServers}] ⊘ Skipping ${isNksNode ? 'NKS' : 'ASG'} server: ${server.serverName}`);
            accountResult.actions.push({ type: 'SKIP_SERVER', targetId: server.serverInstanceNo, targetName: server.serverName, status: 'SKIPPED', error: `${isNksNode ? 'NKS 노드' : 'ASG'} 서버 — 각 서비스에서 관리됨` });
            continue;
          }
          logger.info(`[SERVER ${serverIndex}/${totalServers}] Processing: ${server.serverName} (${server.serverInstanceStatus.code})`);
          if (isDryRun) {
            accountResult.actions.push({ type: 'DELETE_SERVER', targetId: server.serverInstanceNo, targetName: server.serverName, status: 'SKIPPED' });
            continue;
          }

          // 3-1. 반납 보호 해제
          const protectionResult = await ncpClient.server.changeServerProtection(server.serverInstanceNo, false);
          if (!protectionResult.success) {
            logger.warn(`[SERVER ${serverIndex}/${totalServers}] ✗ Protection removal failed: ${protectionResult.error}`);
            accountResult.actions.push({ type: 'REMOVE_PROTECTION', targetId: server.serverInstanceNo, targetName: server.serverName, status: 'FAILED', error: protectionResult.error });
          }
          await new Promise(r => setTimeout(r, 2000));

          // 3-2. Public IP 분리 (서버 반납 전에 명시적으로 처리)
          const pipList = await ncpClient.server.getPublicIpList();
          const attachedPips = pipList.publicIps.filter(ip => ip.serverInstanceAssociatedWithPublicIp?.serverInstanceNo === server.serverInstanceNo);
          for (const pip of attachedPips) {
            const disResult = await ncpClient.server.disassociatePublicIp(pip.publicIpInstanceNo);
            if (disResult.success) { logger.info(`[SERVER ${serverIndex}/${totalServers}] ✓ Public IP ${pip.publicIp} disassociated`); await new Promise(r => setTimeout(r, 1000)); }
            else logger.error(`[SERVER ${serverIndex}/${totalServers}] ✗ Disassociate ${pip.publicIp} failed: ${disResult.error}`);
          }

          // 3-3. 추가 블록 스토리지 분리 및 삭제
          const blockStoragesResult = await ncpClient.server.getBlockStorageList(server.serverInstanceNo);
          if (blockStoragesResult.success && blockStoragesResult.blockStorages.length > 0) {
            const additionalStorages = blockStoragesResult.blockStorages.filter(bs => bs.blockStorageType.code !== 'BASIC');
            if (additionalStorages.length > 0) {
              const storageNos = additionalStorages.map(bs => bs.blockStorageInstanceNo);
              const detachResult = await ncpClient.server.detachBlockStorage(server.serverInstanceNo, storageNos);
              if (detachResult.success) {
                await new Promise(r => setTimeout(r, 3000));
                const deleteResult = await ncpClient.server.deleteBlockStorage(storageNos);
                if (!deleteResult.success) { logger.error(`[SERVER ${serverIndex}/${totalServers}] ✗ Storage delete failed`); accountResult.actions.push({ type: 'DELETE_STORAGE', targetId: storageNos.join(','), targetName: `${server.serverName} storages`, status: 'FAILED', error: deleteResult.error }); }
              } else {
                logger.error(`[SERVER ${serverIndex}/${totalServers}] ✗ Storage detach failed: ${detachResult.error}`);
                accountResult.actions.push({ type: 'DETACH_STORAGE', targetId: server.serverInstanceNo, targetName: server.serverName, status: 'FAILED', error: detachResult.error });
              }
            }
          }

          // 3-4. 실행 중 서버 정지 → 폴링으로 STOPPED 확인 (최대 120초)
          const currentStatus = server.serverInstanceStatus.code;
          if (currentStatus === 'RUN') {
            const stopResult = await ncpClient.server.stopServer(server.serverInstanceNo);
            if (!stopResult.success) {
              logger.error(`[SERVER ${serverIndex}/${totalServers}] ✗ Stop failed: ${stopResult.error}`);
              accountResult.actions.push({ type: 'DELETE_SERVER', targetId: server.serverInstanceNo, targetName: server.serverName, status: 'FAILED', error: `서버 정지 실패: ${stopResult.error}` });
              continue;
            }
            logger.info(`[SERVER ${serverIndex}/${totalServers}] Stop requested — polling for STOPPED (max 120s)...`);
            const stopped = await pollUntilStopped(ncpClient, server.serverInstanceNo, 120000);
            if (!stopped) {
              logger.error(`[SERVER ${serverIndex}/${totalServers}] ✗ Stop timeout (120s)`);
              accountResult.actions.push({ type: 'DELETE_SERVER', targetId: server.serverInstanceNo, targetName: server.serverName, status: 'FAILED', error: '서버 정지 타임아웃 (120초)' });
              continue;
            }
            logger.info(`[SERVER ${serverIndex}/${totalServers}] ✓ Server stopped`);
          } else if (currentStatus === 'NSTOP') {
            logger.info(`[SERVER ${serverIndex}/${totalServers}] Server is stopping — polling for STOPPED (max 120s)...`);
            const stopped = await pollUntilStopped(ncpClient, server.serverInstanceNo, 120000);
            if (!stopped) { accountResult.actions.push({ type: 'DELETE_SERVER', targetId: server.serverInstanceNo, targetName: server.serverName, status: 'FAILED', error: '서버 정지 타임아웃 (120초)' }); continue; }
          }

          // 3-5. 서버 반납
          const terminateResult = await ncpClient.server.terminateServer(server.serverInstanceNo);
          accountResult.actions.push({ type: 'DELETE_SERVER', targetId: server.serverInstanceNo, targetName: server.serverName, status: terminateResult.success ? 'SUCCESS' : 'FAILED', error: terminateResult.error });
          if (terminateResult.success) { logger.info(`[SERVER ${serverIndex}/${totalServers}] ✓ Terminate requested: ${server.serverName}`); terminatedServerNos.push(server.serverInstanceNo); }
          else logger.error(`[SERVER ${serverIndex}/${totalServers}] ✗ Terminate failed: ${terminateResult.error}`);

          await new Promise(r => setTimeout(r, 1000));
        }

        // 3-6. 모든 서버 반납 완료 폴링 (최대 300초) — NIC·Public IP 정리보다 먼저
        if (terminatedServerNos.length > 0 && !isDryRun) {
          logger.info(`[SERVER] Polling until ${terminatedServerNos.length} server(s) are fully terminated (max 300s)...`);
          await pollUntilTerminated(ncpClient, terminatedServerNos, 300000);
          logger.info(`[SERVER] All servers terminated. Proceeding to network cleanup.`);
        }

        // 4. Network Interface 삭제 (서버 반납 완료 후)
        const networkInterfaces = await ncpClient.networkInterface.getNetworkInterfaces();
        const totalNics = networkInterfaces.interfaces.length;
        logger.info(`[NETWORK_INTERFACE] Found ${totalNics} network interfaces`);
        let nicIndex = 0;
        for (const nic of networkInterfaces.interfaces) {
          nicIndex++;
          if (nic.isDefault) { logger.info(`[NETWORK_INTERFACE ${nicIndex}/${totalNics}] Skipping default NIC`); continue; }
          if (isDryRun) {
            accountResult.actions.push({ type: 'DELETE_NETWORK_INTERFACE', targetId: nic.networkInterfaceNo, targetName: nic.networkInterfaceName, status: 'SKIPPED' });
            continue;
          }
          if (nic.instanceNo) {
            const detachResult = await ncpClient.networkInterface.detachNetworkInterface(nic.networkInterfaceNo);
            if (detachResult.success) { logger.info(`[NETWORK_INTERFACE ${nicIndex}/${totalNics}] ✓ Detached`); await new Promise(r => setTimeout(r, 2000)); }
            else logger.error(`[NETWORK_INTERFACE ${nicIndex}/${totalNics}] ✗ Detach failed: ${detachResult.error}`);
          }
          let nicResult, nicRetry = 0;
          while (nicRetry < 3) { nicResult = await ncpClient.networkInterface.deleteNetworkInterface(nic.networkInterfaceNo); if (nicResult.success) break; nicRetry++; if (nicRetry < 3) await new Promise(r => setTimeout(r, 2000 * nicRetry)); }
          accountResult.actions.push({ type: 'DELETE_NETWORK_INTERFACE', targetId: nic.networkInterfaceNo, targetName: nic.networkInterfaceName, status: nicResult.success ? 'SUCCESS' : 'FAILED', error: nicResult.error });
          if (nicResult.success) logger.info(`[NETWORK_INTERFACE ${nicIndex}/${totalNics}] ✓ ${nic.networkInterfaceName} deleted`);
          else logger.error(`[NETWORK_INTERFACE ${nicIndex}/${totalNics}] ✗ ${nic.networkInterfaceName}: ${nicResult.error}`);
          await new Promise(r => setTimeout(r, 500));
        }

        // 5. Public IP 삭제 (서버 반납 완료 후 남은 IP)
        const publicIps = await ncpClient.server.getPublicIpList();
        const totalPublicIps = publicIps.publicIps.length;
        logger.info(`[PUBLIC_IP] Found ${totalPublicIps} public IPs`);
        let publicIpIndex = 0;
        for (const publicIp of publicIps.publicIps) {
          publicIpIndex++;
          if (isDryRun) {
            accountResult.actions.push({ type: 'DELETE_PUBLIC_IP', targetId: publicIp.publicIpInstanceNo, targetName: publicIp.publicIp, status: 'SKIPPED' });
            continue;
          }
          if (publicIp.serverInstanceAssociatedWithPublicIp) {
            const disResult = await ncpClient.server.disassociatePublicIp(publicIp.publicIpInstanceNo);
            if (disResult.success) { await new Promise(r => setTimeout(r, 1000)); } else logger.error(`[PUBLIC_IP ${publicIpIndex}/${totalPublicIps}] ✗ Disassociate failed: ${disResult.error}`);
          }
          const pipResult = await ncpClient.server.deletePublicIp(publicIp.publicIpInstanceNo);
          accountResult.actions.push({ type: 'DELETE_PUBLIC_IP', targetId: publicIp.publicIpInstanceNo, targetName: publicIp.publicIp, status: pipResult.success ? 'SUCCESS' : 'FAILED', error: pipResult.error });
          if (pipResult.success) logger.info(`[PUBLIC_IP ${publicIpIndex}/${totalPublicIps}] ✓ ${publicIp.publicIp} deleted`);
          else logger.error(`[PUBLIC_IP ${publicIpIndex}/${totalPublicIps}] ✗ ${publicIp.publicIp}: ${pipResult.error}`);
          await new Promise(r => setTimeout(r, 500));
        }

        // 6. NAT Gateway 삭제 (Route Table 라우트 먼저 삭제)
        const nats = await ncpClient.vpc.getNatGatewayList();
        const totalNats = nats.natGateways.length;
        logger.info(`[NAT_GATEWAY] Found ${totalNats} NAT gateways`);
        let natIndex = 0;
        for (const nat of nats.natGateways) {
          natIndex++;
          if (isDryRun) {
            accountResult.actions.push({ type: 'DELETE_NAT_GATEWAY', targetId: nat.natGatewayInstanceNo, targetName: nat.natGatewayName, status: 'SKIPPED' });
            continue;
          }
          const removeRoutesResult = await ncpClient.vpc.removeNatGatewayRoutes(nat.natGatewayInstanceNo);
          let totalDeletedRoutes = removeRoutesResult.deletedCount;
          if (totalDeletedRoutes === 0) { const forceResult = await ncpClient.vpc.forceRemoveNatGatewayRoutes(nat.natGatewayInstanceNo, nat.natGatewayName, nat.vpcNo); totalDeletedRoutes += forceResult.deletedCount; }
          if (totalDeletedRoutes > 0) accountResult.actions.push({ type: 'REMOVE_ROUTES', targetId: nat.natGatewayInstanceNo, targetName: nat.natGatewayName, status: 'SUCCESS', error: `${totalDeletedRoutes}개 라우트 삭제됨` });
          logger.info(`[NAT_GATEWAY ${natIndex}/${totalNats}] Waiting 5s for route removal to propagate...`);
          await new Promise(r => setTimeout(r, 5000));
          let natResult, natRetry = 0;
          while (natRetry < 3) { natResult = await ncpClient.vpc.deleteNatGateway(nat.natGatewayInstanceNo); if (natResult.success) break; natRetry++; if (natRetry < 3) await new Promise(r => setTimeout(r, 3000 * natRetry)); }
          accountResult.actions.push({ type: 'DELETE_NAT_GATEWAY', targetId: nat.natGatewayInstanceNo, targetName: nat.natGatewayName, status: natResult.success ? 'SUCCESS' : 'FAILED', error: natResult.error });
          if (natResult.success) logger.info(`[NAT_GATEWAY ${natIndex}/${totalNats}] ✓ ${nat.natGatewayName} deleted`);
          else logger.error(`[NAT_GATEWAY ${natIndex}/${totalNats}] ✗ ${nat.natGatewayName}: ${natResult.error}`);
          await new Promise(r => setTimeout(r, 300));
        }

        // 7. VPC Endpoint 삭제 (Subnet 삭제보다 먼저)
        const endpoints = await ncpClient.vpc.getVpcEndpoints();
        const totalEndpoints = endpoints.endpoints.length;
        logger.info(`[VPC_ENDPOINT] Found ${totalEndpoints} VPC endpoints`);
        let endpointIndex = 0;
        for (const endpoint of endpoints.endpoints) {
          endpointIndex++;
          if (isDryRun) {
            accountResult.actions.push({ type: 'DELETE_VPC_ENDPOINT', targetId: endpoint.vpcEndpointInstanceNo, targetName: endpoint.vpcEndpointName, status: 'SKIPPED' });
            continue;
          }
          const epResult = await ncpClient.vpc.deleteVpcEndpoint(endpoint.vpcEndpointInstanceNo);
          accountResult.actions.push({ type: 'DELETE_VPC_ENDPOINT', targetId: endpoint.vpcEndpointInstanceNo, targetName: endpoint.vpcEndpointName, status: epResult.success ? 'SUCCESS' : 'FAILED', error: epResult.error });
          if (epResult.success) logger.info(`[VPC_ENDPOINT ${endpointIndex}/${totalEndpoints}] ✓ ${endpoint.vpcEndpointName} deleted`);
          else logger.error(`[VPC_ENDPOINT ${endpointIndex}/${totalEndpoints}] ✗ ${endpoint.vpcEndpointName}: ${epResult.error}`);
          await new Promise(r => setTimeout(r, 500));
        }

        // 8. Snapshot 삭제
        const snapshots = await ncpClient.snapshot.getSnapshotList();
        const totalSnapshots = snapshots.snapshots.length;
        logger.info(`[SNAPSHOT] Found ${totalSnapshots} snapshots`);
        let snapshotIndex = 0;
        for (const snapshot of snapshots.snapshots) {
          snapshotIndex++;
          if (isDryRun) {
            accountResult.actions.push({ type: 'DELETE_SNAPSHOT', targetId: snapshot.blockStorageSnapshotInstanceNo, targetName: snapshot.blockStorageSnapshotName, status: 'SKIPPED' });
            continue;
          }
          const snapResult = await ncpClient.snapshot.deleteSnapshot(snapshot.blockStorageSnapshotInstanceNo);
          let snapStatus: 'SUCCESS' | 'FAILED' | 'MANUAL_REQUIRED' = snapResult.success ? 'SUCCESS' : 'FAILED';
          let snapError = snapResult.error;
          if (!snapResult.success && snapResult.error?.includes('in use by the server image')) { snapStatus = 'MANUAL_REQUIRED'; snapError = 'Snapshot is used by server image. Delete server image first via NCP Console.'; }
          accountResult.actions.push({ type: 'DELETE_SNAPSHOT', targetId: snapshot.blockStorageSnapshotInstanceNo, targetName: snapshot.blockStorageSnapshotName, status: snapStatus, error: snapError });
          if (snapResult.success) logger.info(`[SNAPSHOT ${snapshotIndex}/${totalSnapshots}] ✓ ${snapshot.blockStorageSnapshotName} deleted`);
          else if (snapStatus === 'FAILED') logger.error(`[SNAPSHOT ${snapshotIndex}/${totalSnapshots}] ✗ ${snapshot.blockStorageSnapshotName}: ${snapResult.error}`);
          await new Promise(r => setTimeout(r, 500));
        }

        // 9. Server Image — API 미지원, 수동 삭제 필요
        const serverImages = await ncpClient.snapshot.getServerImageList();
        if (serverImages.serverImages.length > 0) {
          logger.info(`[SERVER_IMAGE] Found ${serverImages.serverImages.length} images (manual required)`);
          accountResult.actions.push({ type: 'DELETE_SERVER_IMAGE_BULK', targetId: 'manual-required', targetName: `${serverImages.serverImages.length} server images`, status: 'MANUAL_REQUIRED', error: 'NCP API does not support server image deletion. Please delete manually via NCP Console.' });
        }

        // 10. Subnet 삭제 (재시도 포함)
        const subnets = await ncpClient.vpc.getSubnetList();
        const totalSubnets = subnets.subnets.length;
        logger.info(`[SUBNET] Found ${totalSubnets} subnets`);
        let subnetIndex = 0;
        for (const subnet of subnets.subnets) {
          subnetIndex++;
          if (isDryRun) {
            accountResult.actions.push({ type: 'DELETE_SUBNET', targetId: subnet.subnetNo, targetName: subnet.subnetName, status: 'SKIPPED' });
            continue;
          }
          let subnetResult, subnetRetry = 0;
          while (subnetRetry < 5) { subnetResult = await ncpClient.vpc.deleteSubnet(subnet.subnetNo); if (subnetResult.success) break; subnetRetry++; if (subnetRetry < 5) { logger.warn(`[SUBNET ${subnetIndex}/${totalSubnets}] ⚠ Retry ${subnetRetry}/5: ${subnetResult.error}`); await new Promise(r => setTimeout(r, 3000 * subnetRetry)); } }
          accountResult.actions.push({ type: 'DELETE_SUBNET', targetId: subnet.subnetNo, targetName: subnet.subnetName, status: subnetResult.success ? 'SUCCESS' : 'FAILED', error: subnetResult.error });
          if (subnetResult.success) logger.info(`[SUBNET ${subnetIndex}/${totalSubnets}] ✓ ${subnet.subnetName} deleted`);
          else logger.error(`[SUBNET ${subnetIndex}/${totalSubnets}] ✗ ${subnet.subnetName}: ${subnetResult.error}`);
          await new Promise(r => setTimeout(r, 1000));
        }

        // 11. VPC Peering — API 미지원, 수동 삭제 필요
        const peerings = await ncpClient.vpc.getVpcPeeringList();
        const totalPeerings = peerings.peerings.length;
        if (totalPeerings > 0) logger.info(`[VPC_PEERING] Found ${totalPeerings} peerings (manual required)`);
        for (const peering of peerings.peerings) {
          accountResult.actions.push({
            type: 'DELETE_VPC_PEERING',
            targetId: peering.vpcPeeringInstanceNo,
            targetName: peering.vpcPeeringName,
            status: 'MANUAL_REQUIRED',
            error: 'NCP API does not support VPC peering deletion. Please delete manually via NCP Console.'
          });
        }

        // 12. VPC 삭제 (재시도 포함)
        const vpcs = await ncpClient.vpc.getVpcList();
        const totalVpcs = vpcs.vpcs.length;
        logger.info(`[VPC] Found ${totalVpcs} VPCs`);
        let vpcIndex = 0;
        for (const vpc of vpcs.vpcs) {
          vpcIndex++;
          if (isDryRun) {
            accountResult.actions.push({ type: 'DELETE_VPC', targetId: vpc.vpcNo, targetName: vpc.vpcName, status: 'SKIPPED' });
            continue;
          }
          let vpcResult, vpcRetry = 0;
          while (vpcRetry < 5) { vpcResult = await ncpClient.vpc.deleteVpc(vpc.vpcNo); if (vpcResult.success) break; vpcRetry++; if (vpcRetry < 5) { logger.warn(`[VPC ${vpcIndex}/${totalVpcs}] ⚠ Retry ${vpcRetry}/5: ${vpcResult.error}`); await new Promise(r => setTimeout(r, 2000 * vpcRetry)); } }
          accountResult.actions.push({ type: 'DELETE_VPC', targetId: vpc.vpcNo, targetName: vpc.vpcName, status: vpcResult.success ? 'SUCCESS' : 'FAILED', error: vpcResult.error });
          if (vpcResult.success) logger.info(`[VPC ${vpcIndex}/${totalVpcs}] ✓ ${vpc.vpcName} deleted`);
          else logger.error(`[VPC ${vpcIndex}/${totalVpcs}] ✗ ${vpc.vpcName}: ${vpcResult.error}`);
          await new Promise(r => setTimeout(r, 1500));
        }

        // 13. 서브계정 삭제
        const subAccounts = await ncpClient.subAccount.getSubAccounts();
        const totalSubs = subAccounts.accounts.length;
        logger.info(`[SUBACCOUNT] Found ${totalSubs} sub-accounts`);
        let subIndex = 0;
        for (const sub of subAccounts.accounts) {
          subIndex++;
          if (isDryRun) {
            accountResult.actions.push({ type: 'DELETE_SUBACCOUNT', targetId: sub.subAccountId, targetName: sub.subAccountName, status: 'SKIPPED' });
            continue;
          }
          const subResult = await ncpClient.subAccount.deleteSubAccount(sub.subAccountId);
          accountResult.actions.push({ type: 'DELETE_SUBACCOUNT', targetId: sub.subAccountId, targetName: sub.subAccountName, status: subResult.success ? 'SUCCESS' : 'FAILED', error: subResult.error });
          if (subResult.success) {
            logger.info(`[SUBACCOUNT ${subIndex}/${totalSubs}] ✓ ${sub.subAccountName} deleted`);
            await prisma.subAccount.deleteMany({ where: { ncpAccountId: account.id, subAccountId: sub.subAccountId } });
          } else {
            logger.error(`[SUBACCOUNT ${subIndex}/${totalSubs}] ✗ ${sub.subAccountName}: ${subResult.error}`);
          }
          await new Promise(r => setTimeout(r, 100));
        }

        // 전체 성공 여부 판단
        accountResult.success = accountResult.actions.every(a => a.status !== 'FAILED');

      } catch (err) {
        accountResult.success = false;
        accountResult.error = err instanceof Error ? err.message : '알 수 없는 오류';
      }

      results.push(accountResult);
    }

    // 요약 통계
    const summary = {
      totalAccounts: accounts.length,
      totalActions: results.reduce((sum, r) => sum + r.actions.length, 0),
      successActions: results.reduce((sum, r) => sum + r.actions.filter(a => a.status === 'SUCCESS').length, 0),
      failedActions: results.reduce((sum, r) => sum + r.actions.filter(a => a.status === 'FAILED').length, 0),
      skippedActions: results.reduce((sum, r) => sum + r.actions.filter(a => a.status === 'SKIPPED').length, 0),
      manualRequiredActions: results.reduce((sum, r) => sum + r.actions.filter(a => a.status === 'MANUAL_REQUIRED').length, 0)
    };

    // 감사 로그
    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'COURSE_BULK_CLEANUP',
      entityType: 'Course',
      entityId: courseId,
      newValue: { accountIds, isDryRun, ...summary }
    });

    res.json({
      success: true,
      data: {
        isDryRun,
        total: accounts.length,
        results,
        summary
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 과정 누적 전체 사용료 조회 (NCP billing API 직접 호출 - 청구금액 기준)
 * 과정 시작월 ~ 종료월(또는 현재월) 구간의 demandAmount 합산
 */
export const getCourseCumulativeCosts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        accounts: {
          where: { isActive: true },
          select: {
            id: true,
            displayName: true,
            accessKeyEncrypted: true,
            secretKeyEncrypted: true,
            accessKeyHash: true,
            isMaster: true,
            ncpMemberNo: true
          }
        }
      }
    });

    if (!course) {
      throw new AppError('Course not found', 404);
    }

    // 과정 기간에 해당하는 월 계산
    const toYM = (d: Date) =>
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;

    const startMonth = toYM(new Date(course.startDate));
    const now = new Date();
    // 전체 사용료는 과정 종료 여부와 관계없이 오늘까지 집계
    // (과정 종료 후에도 계정이 남아 비용이 발생하는 경우를 모두 포함)
    const endMonth = toYM(now);

    // 누적 개월 수 계산
    const sy = parseInt(startMonth.slice(0, 4));
    const sm = parseInt(startMonth.slice(4));
    const ey = parseInt(endMonth.slice(0, 4));
    const em = parseInt(endMonth.slice(4));
    const periods = (ey - sy) * 12 + (em - sm) + 1;

    // Organization 마스터 계정 확인
    const masterAccount = course.accounts.find(a => a.isMaster);

    let byAccount: Array<{ accountId: string; accountName: string; cost: number; isMaster?: boolean }>;
    let totalCost: number;

    const accountResults: Array<{ accountId: string; accountName: string; cost: number; isMaster?: boolean }> = [];
    const BATCH_SIZE = 5;

    // 마스터 + 회원번호 모두 있으면 → 마스터 credentials + memberNoList (가장 정확)
    const subAccounts = course.accounts.filter(a => !a.isMaster);
    const allHaveMemberNo = masterAccount && subAccounts.length > 0 && subAccounts.every(a => a.ncpMemberNo);

    if (allHaveMemberNo && masterAccount) {
      const masterAccessKey = decrypt(masterAccount.accessKeyEncrypted);
      const masterSecretKey = decrypt(masterAccount.secretKeyEncrypted);
      const masterClient = new NcpClient({ accessKey: masterAccessKey, secretKey: masterSecretKey });

      // 마스터: org 레벨 할인 반영된 실제 청구 금액 (getDemandCostList, isOrganization 없이)
      const orgResult = await masterClient.billing.getCumulativeInvoiceCost(startMonth, endMonth);
      const orgTotal = orgResult.invoiceDemandAmount;
      accountResults.push({
        accountId: masterAccount.id,
        accountName: masterAccount.displayName || `${masterAccount.accessKeyHash.substring(0, 8)}...`,
        cost: orgTotal,
        isMaster: true
      });

      // 각 하위계정: 마스터 credentials + memberNoList=[해당 멤버번호] → 멤버별 정확한 비용
      for (let i = 0; i < subAccounts.length; i += BATCH_SIZE) {
        const batch = subAccounts.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map(async (account) => {
            const result = await masterClient.billing.getCumulativeInvoiceCost(
              startMonth, endMonth, [account.ncpMemberNo!]
            );
            return {
              accountId: account.id,
              accountName: account.displayName || `${account.accessKeyHash.substring(0, 8)}...`,
              cost: result.invoiceDemandAmount,
              isMaster: false
            };
          })
        );
        for (const r of batchResults) {
          if (r.status === 'fulfilled') accountResults.push(r.value);
          else logger.warn(`[CumulativeCosts] memberNoList fetch failed: ${r.reason}`);
        }
      }

      byAccount = accountResults.sort((a, b) => b.cost - a.cost);
      totalCost = orgTotal;
      logger.info(`[CumulativeCosts] memberNoList mode — org total: ${orgTotal}원, accounts: ${subAccounts.length}`);
    } else {
      // 회원번호 없거나 마스터 없음 → 계정별 개별 조회
      for (let i = 0; i < course.accounts.length; i += BATCH_SIZE) {
        const batch = course.accounts.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map(async (account) => {
            const accessKey = decrypt(account.accessKeyEncrypted);
            const secretKey = decrypt(account.secretKeyEncrypted);
            const ncpClient = new NcpClient({ accessKey, secretKey });

            const result = await ncpClient.billing.getCumulativeInvoiceCost(startMonth, endMonth);
            return {
              accountId: account.id,
              accountName: account.displayName || `${account.accessKeyHash.substring(0, 8)}...`,
              cost: result.invoiceDemandAmount,
              isMaster: account.isMaster
            };
          })
        );
        for (const r of batchResults) {
          if (r.status === 'fulfilled') accountResults.push(r.value);
          else logger.warn(`[CumulativeCosts] Account fetch failed: ${r.reason}`);
        }
      }

      byAccount = accountResults.sort((a, b) => b.cost - a.cost);
      // ncpMemberNo 미설정 계정들은 각자 독립 org 마스터일 수 있으므로 합산
      totalCost = byAccount.reduce((sum, a) => sum + a.cost, 0);
      logger.info(`[CumulativeCosts] individual mode — sum: ${totalCost}원, accounts: ${byAccount.length}`);
    }

    // 계산된 누적 비용을 Course 레코드에 캐시 저장 (대시보드와 일치시키기 위해)
    await prisma.course.update({
      where: { id: courseId },
      data: {
        totalCumulativeCost: totalCost,
        cumulativeCostUpdatedAt: new Date()
      }
    });

    res.json({
      success: true,
      data: { totalCost, periods, byAccount, startMonth, endMonth }
    });
  } catch (error) {
    next(error);
  }
};
