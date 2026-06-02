/**
 * 모니터링 및 비용 집계 컨트롤러
 */

import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middlewares/auth';
import { AppError } from '../middlewares/errorHandler';
import { decrypt } from '../utils/encryption';
import { NcpClient } from '../services/ncp';

const prisma = new PrismaClient();

/**
 * 과정별 리소스 현황
 */
export const getCourseResources = async (
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
            secretKeyEncrypted: true
          }
        }
      }
    });

    if (!course) {
      throw new AppError('Course not found', 404);
    }

    const resourceSummary: Array<{
      accountId: string;
      displayName: string;
      resources: Record<string, number>;
      services: string[];
      error?: string;
    }> = [];

    for (const account of course.accounts) {
      try {
        const accessKey = decrypt(account.accessKeyEncrypted);
        const secretKey = decrypt(account.secretKeyEncrypted);

        const ncpClient = new NcpClient({ accessKey, secretKey });

        const [resources, services] = await Promise.all([
          ncpClient.getAllResources(),
          ncpClient.billing.getActiveServices()
        ]);

        resourceSummary.push({
          accountId: account.id,
          displayName: account.displayName || '',
          resources: {
            servers: resources.servers.count,
            vpcs: resources.vpcs.count,
            subnets: resources.subnets.count,
            natGateways: resources.natGateways.count,
            blockStorages: resources.blockStorages.count,
            nasVolumes: resources.nasVolumes.count,
            loadBalancers: resources.loadBalancers.count,
            subAccounts: resources.subAccounts.count
          },
          services: services.services
        });
      } catch (err) {
        resourceSummary.push({
          accountId: account.id,
          displayName: account.displayName || '',
          resources: {},
          services: [],
          error: err instanceof Error ? err.message : 'Unknown error'
        });
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // 집계
    const totals = resourceSummary.reduce(
      (acc, item) => {
        for (const [key, value] of Object.entries(item.resources)) {
          acc[key] = (acc[key] || 0) + (value || 0);
        }
        return acc;
      },
      {} as Record<string, number>
    );

    res.json({
      success: true,
      data: {
        courseId,
        courseName: course.name,
        accountCount: course.accounts.length,
        totals,
        accounts: resourceSummary
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 과정별 비용 현황
 */
export const getCourseCosts = async (
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
            secretKeyEncrypted: true
          }
        },
        costSnapshots: {
          orderBy: { periodStart: 'desc' },
          take: 12
        }
      }
    });

    if (!course) {
      throw new AppError('Course not found', 404);
    }

    // 현재 비용 조회
    let currentTotalCost = 0;
    const costByAccount: Array<{
      accountId: string;
      displayName: string;
      services: Array<{ name: string; cost: number }>;
      totalCost: number;
      error?: string;
    }> = [];

    for (const account of course.accounts) {
      try {
        const accessKey = decrypt(account.accessKeyEncrypted);
        const secretKey = decrypt(account.secretKeyEncrypted);

        const ncpClient = new NcpClient({ accessKey, secretKey });
        const services = await ncpClient.billing.getActiveServices();

        const accountCost = services.serviceDetails.reduce(
          (sum, s) => sum + (s.cost || 0),
          0
        );

        currentTotalCost += accountCost;

        costByAccount.push({
          accountId: account.id,
          displayName: account.displayName || '',
          services: services.serviceDetails.map(s => ({
            name: s.serviceName,
            cost: s.cost
          })),
          totalCost: accountCost
        });
      } catch (err) {
        costByAccount.push({
          accountId: account.id,
          displayName: account.displayName || '',
          services: [],
          totalCost: 0,
          error: err instanceof Error ? err.message : 'Unknown error'
        });
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    res.json({
      success: true,
      data: {
        courseId,
        courseName: course.name,
        currentTotalCost,
        currency: 'KRW',
        accounts: costByAccount,
        history: course.costSnapshots
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 전체 대시보드 데이터
 */
export const getDashboard = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const [
      courseStats,
      accountStats,
      recentSnapshots,
      recentAuditLogs,
      latestSnapshotsPerCourse
    ] = await Promise.all([
      prisma.course.groupBy({
        by: ['status'],
        _count: true
      }),
      prisma.ncpAccount.aggregate({
        _count: true,
        where: { isActive: true }
      }),
      prisma.costSnapshot.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          course: { select: { name: true } }
        }
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          user: { select: { name: true, email: true } }
        }
      }),
      // 과정별 최신 스냅샷 (전체 누적 비용 계산용)
      prisma.costSnapshot.findMany({
        distinct: ['courseId'],
        orderBy: { createdAt: 'desc' },
        select: { courseId: true, totalCost: true, createdAt: true }
      })
    ]);

    // 활성 과정 수
    const activeCourses = await prisma.course.count({
      where: {
        status: 'ACTIVE',
        startDate: { lte: new Date() },
        endDate: { gte: new Date() }
      }
    });

    // 종료 임박 과정 (7일 이내)
    const endingSoon = await prisma.course.findMany({
      where: {
        status: 'ACTIVE',
        endDate: {
          gte: new Date(),
          lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        }
      },
      select: { id: true, name: true, endDate: true }
    });

    const totalCostAllCourses = latestSnapshotsPerCourse.reduce(
      (sum, s) => sum + (s.totalCost || 0),
      0
    );

    res.json({
      success: true,
      data: {
        summary: {
          totalCourses: courseStats.reduce((sum, c) => sum + c._count, 0),
          activeCourses,
          totalActiveAccounts: accountStats._count,
          coursesByStatus: courseStats.reduce((acc, c) => {
            acc[c.status] = c._count;
            return acc;
          }, {} as Record<string, number>),
          totalCostAllCourses,
          costSnapshotCount: latestSnapshotsPerCourse.length
        },
        alerts: {
          endingSoon
        },
        recentCostSnapshots: recentSnapshots,
        recentActivity: recentAuditLogs
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * CSV 내보내기 (비용 스냅샷)
 */
export const exportCostsCsv = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        costSnapshots: {
          orderBy: { periodStart: 'asc' }
        }
      }
    });

    if (!course) {
      throw new AppError('Course not found', 404);
    }

    // CSV 생성
    const headers = ['Period Start', 'Period End', 'Total Cost', 'Currency', 'Account Count'];
    const rows = course.costSnapshots.map(s => [
      s.periodStart.toISOString().slice(0, 10),
      s.periodEnd.toISOString().slice(0, 10),
      s.totalCost.toString(),
      s.currency,
      s.accountCount.toString()
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="cost_report_${courseId}.csv"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
};

/**
 * 계정/서브계정 CSV 내보내기
 */
export const exportAccountsCsv = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;
    const { includeSubAccounts } = req.query;

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        accounts: {
          where: { isActive: true },
          include: {
            subAccounts: includeSubAccounts === 'true'
          },
          orderBy: { displayName: 'asc' }
        }
      }
    });

    if (!course) {
      throw new AppError('Course not found', 404);
    }

    // BOM for Excel UTF-8 compatibility
    const BOM = '\uFEFF';

    if (includeSubAccounts === 'true') {
      // 서브계정 포함 내보내기
      const headers = ['계정이름', '서브계정ID', '서브계정로그인ID', '서브계정이름', '이메일', '생성일'];
      const rows: string[][] = [];

      for (const account of course.accounts) {
        if (account.subAccounts.length === 0) {
          rows.push([
            account.displayName || '',
            '',
            '',
            '',
            '',
            ''
          ]);
        } else {
          for (const subAcc of account.subAccounts) {
            rows.push([
              account.displayName || '',
              subAcc.subAccountId,
              subAcc.name || '',
              subAcc.name || '',
              subAcc.email || '',
              subAcc.createdAt?.toISOString().slice(0, 10) || ''
            ]);
          }
        }
      }

      const csv = BOM + [headers.join(','), ...rows.map(r => r.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))].join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="accounts_subaccounts_${courseId}.csv"`);
      res.send(csv);
    } else {
      // 계정만 내보내기
      const headers = ['계정이름', 'AccessKey(일부)', '서브계정수', '마지막동기화', '등록일'];
      const rows = course.accounts.map(acc => [
        acc.displayName || '',
        acc.accessKeyHash ? acc.accessKeyHash.substring(0, 12) + '...' : '',
        acc.subAccounts.length.toString(),
        acc.lastSyncAt?.toISOString().slice(0, 10) || '',
        acc.createdAt.toISOString().slice(0, 10)
      ]);

      const csv = BOM + [headers.join(','), ...rows.map(r => r.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))].join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="accounts_${courseId}.csv"`);
      res.send(csv);
    }
  } catch (error) {
    next(error);
  }
};

/**
 * 전체 크레딧 현황 조회 (DB 캐시 우선)
 * ?refresh=true 파라미터로 NCP API 직접 조회 가능
 */
export const getCredits = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const forceRefresh = req.query.refresh === 'true';

    const masterAccounts = await prisma.ncpAccount.findMany({
      where: { isMaster: true, isActive: true },
      select: {
        id: true,
        displayName: true,
        accessKeyEncrypted: true,
        secretKeyEncrypted: true,
        accessKeyHash: true,
        creditData: true,
        creditUpdatedAt: true,
        course: { select: { id: true, name: true } }
      }
    });

    if (masterAccounts.length === 0) {
      res.json({ success: true, data: { accounts: [], totalCredit: 0, usedCredit: 0, remainCredit: 0 } });
      return;
    }

    // 중복 제거
    const seen = new Set<string>();
    const uniqueMasters = masterAccounts.filter(a => {
      const key = a.accessKeyHash || a.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // DB 캐시가 있고 강제 새로고침이 아니면 캐시 반환 (NCP API 호출 생략)
    const allHaveCache = uniqueMasters.every(m => m.creditData != null);
    if (allHaveCache && !forceRefresh) {
      const accounts = uniqueMasters.map(master => ({
        accountId: master.id,
        accountName: master.displayName || master.id,
        courseName: master.course.name,
        courseId: master.course.id,
        updatedAt: master.creditUpdatedAt,
        ...(master.creditData as object)
      }));
      type CachedAccount = { totalCredit?: number; usedCredit?: number; remainCredit?: number };
      const totalCredit  = accounts.reduce((s, a) => s + ((a as CachedAccount).totalCredit  ?? 0), 0);
      const usedCredit   = accounts.reduce((s, a) => s + ((a as CachedAccount).usedCredit   ?? 0), 0);
      const remainCredit = accounts.reduce((s, a) => s + ((a as CachedAccount).remainCredit ?? 0), 0);
      res.json({ success: true, data: { accounts, totalCredit, usedCredit, remainCredit, fromCache: true } });
      return;
    }

    // 캐시 없거나 강제 새로고침 → NCP API 조회 후 DB 저장
    const results = await Promise.allSettled(
      uniqueMasters.map(async (master) => {
        const accessKey = decrypt(master.accessKeyEncrypted);
        const secretKey = decrypt(master.secretKeyEncrypted);
        const ncpClient = new NcpClient({ accessKey, secretKey });
        const credit = await ncpClient.billing.getCreditBalance();

        // DB에 캐시 저장
        await prisma.ncpAccount.update({
          where: { id: master.id },
          data: { creditData: credit as object, creditUpdatedAt: new Date() }
        });

        return {
          accountId: master.id,
          accountName: master.displayName || master.id,
          courseName: master.course.name,
          courseId: master.course.id,
          ...credit
        };
      })
    );

    type AccountCreditResult = { success: boolean; totalCredit: number; usedCredit: number; remainCredit: number };
    const accounts = results
      .filter((r): r is PromiseFulfilledResult<AccountCreditResult & Record<string, unknown>> => r.status === 'fulfilled')
      .map(r => r.value);
    const totalCredit  = accounts.reduce((s, a) => s + (a.success ? a.totalCredit  : 0), 0);
    const usedCredit   = accounts.reduce((s, a) => s + (a.success ? a.usedCredit   : 0), 0);
    const remainCredit = accounts.reduce((s, a) => s + (a.success ? a.remainCredit : 0), 0);

    res.json({ success: true, data: { accounts, totalCredit, usedCredit, remainCredit, fromCache: false } });
  } catch (error) {
    next(error);
  }
};
