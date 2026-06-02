/**
 * 과정 비용 컨트롤러
 * 누적 사용료 조회 및 캐시 저장
 */

import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middlewares/auth';
import { AppError } from '../middlewares/errorHandler';
import { decrypt } from '../utils/encryption';
import { NcpClient } from '../services/ncp';
import logger from '../utils/logger';

const prisma = new PrismaClient();

/**
 * 과정 누적 전체 사용료 조회 (NCP billing API 직접 호출)
 * 과정 시작월 ~ 현재월 구간의 demandAmount 합산
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

    if (!course) throw new AppError('Course not found', 404);

    const toYM = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;

    const startMonth = toYM(new Date(course.startDate));
    const now = new Date();
    const endMonth = toYM(now);

    const sy = parseInt(startMonth.slice(0, 4));
    const sm = parseInt(startMonth.slice(4));
    const ey = parseInt(endMonth.slice(0, 4));
    const em = parseInt(endMonth.slice(4));
    const periods = (ey - sy) * 12 + (em - sm) + 1;

    const masterAccount = course.accounts.find(a => a.isMaster);
    const subAccounts = course.accounts.filter(a => !a.isMaster);
    const allHaveMemberNo = masterAccount && subAccounts.length > 0 && subAccounts.every(a => a.ncpMemberNo);

    const accountResults: Array<{ accountId: string; accountName: string; cost: number; isMaster?: boolean }> = [];
    let totalCost: number;

    if (allHaveMemberNo && masterAccount) {
      const masterAccessKey = decrypt(masterAccount.accessKeyEncrypted);
      const masterSecretKey = decrypt(masterAccount.secretKeyEncrypted);
      const masterClient = new NcpClient({ accessKey: masterAccessKey, secretKey: masterSecretKey });

      const [orgResult, ...subResults] = await Promise.allSettled([
        masterClient.billing.getCumulativeInvoiceCost(startMonth, endMonth),
        ...subAccounts.map(account =>
          masterClient.billing.getCumulativeInvoiceCost(startMonth, endMonth, [account.ncpMemberNo!])
        )
      ]);

      const orgTotal = orgResult.status === 'fulfilled' ? orgResult.value.invoiceDemandAmount : 0;
      accountResults.push({
        accountId: masterAccount.id,
        accountName: masterAccount.displayName || `${masterAccount.accessKeyHash.substring(0, 8)}...`,
        cost: orgTotal,
        isMaster: true
      });

      subAccounts.forEach((account, idx) => {
        const r = subResults[idx];
        const cost = r?.status === 'fulfilled' ? r.value.invoiceDemandAmount : 0;
        if (r?.status === 'rejected') logger.warn(`[CumulativeCosts] failed: ${account.displayName}`, r.reason);
        accountResults.push({
          accountId: account.id,
          accountName: account.displayName || `${account.accessKeyHash.substring(0, 8)}...`,
          cost,
          isMaster: false
        });
      });

      totalCost = orgTotal;
      logger.info(`[CumulativeCosts] parallel mode — org total: ${orgTotal}원, accounts: ${subAccounts.length}`);
    } else {
      const batchResults = await Promise.allSettled(
        course.accounts.map(async (account) => {
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

      totalCost = accountResults.reduce((sum, a) => sum + a.cost, 0);
      logger.info(`[CumulativeCosts] parallel mode — sum: ${totalCost}원, accounts: ${accountResults.length}`);
    }

    const byAccount = accountResults.sort((a, b) => b.cost - a.cost);
    const savedAt = new Date();

    // 과정 레벨 캐시 저장
    await prisma.course.update({
      where: { id: courseId },
      data: { totalCumulativeCost: totalCost, cumulativeCostUpdatedAt: savedAt }
    });

    // 계정별 캐시 저장
    await Promise.allSettled(
      byAccount
        .filter(a => !a.isMaster)
        .map(a =>
          prisma.ncpAccount.update({
            where: { id: a.accountId },
            data: { totalCumulativeCost: a.cost, cumulativeCostUpdatedAt: savedAt }
          })
        )
    );

    res.json({ success: true, data: { totalCost, periods, byAccount, startMonth, endMonth } });
  } catch (error) {
    next(error);
  }
};
