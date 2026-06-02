/**
 * 과정 전체 동기화 컨트롤러
 */

import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middlewares/auth';
import { createAuditLog, extractAuditInfo } from '../middlewares/audit';
import { decrypt } from '../utils/encryption';
import { NcpClient } from '../services/ncp';
import logger from '../utils/logger';

const prisma = new PrismaClient();

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
    const BATCH_SIZE = 10;

    const accounts = await prisma.ncpAccount.findMany({
      where: { courseId },
      select: {
        id: true,
        displayName: true,
        accessKeyEncrypted: true,
        secretKeyEncrypted: true,
        accessKeyHash: true,
        isMaster: true,
        ncpMemberNo: true
      }
    });

    if (accounts.length === 0) {
      res.json({
        success: true,
        data: {
          total: 0,
          results: [],
          summary: { totalSubAccounts: 0, totalResources: 0, totalCost: 0, accountsWithResources: 0 }
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
      services: string[];
      error?: string;
    }

    const INFRA_PREFIXES = [
      'Server', 'Block Storage', 'Virtual Private Cloud', 'Public IP',
      'Network -', 'Software', 'Load Balancer', 'VPC Maintenance',
      'NAT Gateway', 'Snapshot', 'NAS', 'Rule Count',
      'Private IP', 'Inbound Data', 'Network IN', 'Network OUT'
    ];
    const isSubscriptionService = (name: string) =>
      !INFRA_PREFIXES.some(prefix => name.startsWith(prefix));

    const results: AccountSyncResult[] = [];

    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
      const batch = accounts.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(async (account) => {
          const accessKey = decrypt(account.accessKeyEncrypted);
          const secretKey = decrypt(account.secretKeyEncrypted);
          const ncpClient = new NcpClient({ accessKey, secretKey });

          const [subAccResult, resourcesResult, costResult] = await Promise.allSettled([
            ncpClient.subAccount.getSubAccounts(),
            ncpClient.getAllResources(),
            ncpClient.billing.getCurrentMonthCost(account.isMaster ? true : undefined)
          ]);

          // 서브계정 동기화
          let subAccountCount = 0;
          if (subAccResult.status === 'fulfilled' && subAccResult.value.success) {
            subAccountCount = subAccResult.value.accounts.length;
            const currentIds = subAccResult.value.accounts.map(s => s.subAccountId);
            if (currentIds.length > 0) {
              await prisma.subAccount.deleteMany({
                where: { ncpAccountId: account.id, subAccountId: { notIn: currentIds } }
              });
            }
            for (const sub of subAccResult.value.accounts) {
              const displayName = sub.subAccountName || sub.subAccountLoginId || sub.subAccountId;
              await prisma.subAccount.upsert({
                where: { ncpAccountId_subAccountId: { ncpAccountId: account.id, subAccountId: sub.subAccountId } },
                update: { name: displayName, email: sub.email },
                create: { ncpAccountId: account.id, subAccountId: sub.subAccountId, name: displayName, email: sub.email }
              });
            }
          }

          // 리소스 집계
          const resources: Record<string, number> = {};
          let totalResourceCount = 0;
          if (resourcesResult.status === 'fulfilled') {
            const data = resourcesResult.value;
            if (data.servers?.count > 0)       resources.servers       = data.servers.count;
            if (data.vpcs?.count > 0)           resources.vpcs          = data.vpcs.count;
            if (data.subnets?.count > 0)        resources.subnets       = data.subnets.count;
            if (data.natGateways?.count > 0)    resources.natGateways   = data.natGateways.count;
            if (data.blockStorages?.count > 0)  resources.blockStorages = data.blockStorages.count;
            if (data.nasVolumes?.count > 0)     resources.nasVolumes    = data.nasVolumes.count;
            if (data.loadBalancers?.count > 0)  resources.loadBalancers = data.loadBalancers.count;
            if (data.targetGroups?.count > 0)   resources.targetGroups  = data.targetGroups.count;
            totalResourceCount = Object.values(resources).reduce((sum, c) => sum + c, 0);
          }

          // 비용 조회
          let totalCost = 0;
          let totalUseAmount = 0;
          if (costResult.status === 'fulfilled' && costResult.value.success) {
            totalCost = costResult.value.invoiceDemandAmount ?? costResult.value.totalDemandAmount ?? 0;
            totalUseAmount = costResult.value.invoiceUseAmount ?? costResult.value.totalUseAmount ?? 0;
          }

          // 구독 서비스 (memberNo 없는 계정은 org 전체 데이터 → 빈 배열)
          let services: string[] = [];
          if (account.isMaster || account.ncpMemberNo) {
            const serviceSet = new Set<string>();
            if (costResult.status === 'fulfilled' && costResult.value.success) {
              for (const c of costResult.value.costs ?? []) {
                if (c.productName && c.productName !== '알 수 없음' && isSubscriptionService(c.productName)) {
                  serviceSet.add(c.productName);
                }
              }
            }
            services = Array.from(serviceSet);
          }

          await prisma.ncpAccount.update({ where: { id: account.id }, data: { lastSyncAt: new Date() } });

          return {
            accountId: account.id,
            accountName: account.displayName || account.accessKeyHash?.substring(0, 12) || account.id,
            success: true,
            subAccountCount,
            resources,
            totalResourceCount,
            totalCost,
            totalUseAmount,
            services
          };
        })
      );

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
            services: [],
            error: result.reason?.message || '알 수 없는 오류'
          });
        }
      });
    }

    // 마스터 계정 기준 총비용 (이중 집계 방지)
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

    const totalSyncCost = summary.totalUseAmount || summary.totalCost;
    if (totalSyncCost >= 0) {
      const now = new Date();
      await prisma.costSnapshot.create({
        data: {
          courseId,
          periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
          periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0),
          totalCost: totalSyncCost,
          accountCount: accounts.length,
          breakdown: { byAccount: results.map(r => ({ accountId: r.accountId, accountName: r.accountName, cost: r.totalUseAmount || r.totalCost })) }
        }
      });
    }

    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'COURSE_SYNC_ALL',
      entityType: 'Course',
      entityId: courseId,
      newValue: { accounts: accounts.length, ...summary }
    });

    res.json({ success: true, data: { total: accounts.length, results, summary } });
  } catch (error) {
    next(error);
  }
};
