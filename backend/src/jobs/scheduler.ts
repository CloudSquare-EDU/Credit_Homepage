/**
 * 스케줄러 - 자동 작업 관리
 * - 비용 스냅샷 자동 저장
 * - 종료 과정 자동 정리
 * - 리소스 동기화
 */

import cron from 'node-cron';
import { PrismaClient, CourseStatus, CleanupStatus } from '@prisma/client';
import { decrypt } from '../utils/encryption';
import { NcpClient } from '../services/ncp';
import logger from '../utils/logger';

const prisma = new PrismaClient();

/**
 * 일일 비용 스냅샷 저장 (매일 02:00)
 * 각 활성 과정의 마스터 계정 기준 이번 달 비용 스냅샷 저장
 */
async function dailyCostSnapshot(): Promise<void> {
  logger.info('Starting daily cost snapshot job');

  try {
    const activeCourses = await prisma.course.findMany({
      where: { status: CourseStatus.ACTIVE },
      include: {
        accounts: {
          where: { isActive: true },
          select: { id: true, accessKeyEncrypted: true, secretKeyEncrypted: true, isMaster: true }
        }
      }
    });

    for (const course of activeCourses) {
      try {
        // 마스터 계정 우선 사용, 없으면 첫 번째 계정
        const targetAccount = course.accounts.find(a => a.isMaster) ?? course.accounts[0];
        if (!targetAccount) continue;

        const accessKey = decrypt(targetAccount.accessKeyEncrypted);
        const secretKey = decrypt(targetAccount.secretKeyEncrypted);
        const ncpClient = new NcpClient({ accessKey, secretKey });

        const costResult = await ncpClient.billing.getCurrentMonthCost(targetAccount.isMaster ? true : undefined);
        const totalCost = costResult.success
          ? (costResult.invoiceDemandAmount ?? costResult.totalDemandAmount ?? 0)
          : 0;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        await prisma.costSnapshot.create({
          data: {
            courseId: course.id,
            periodStart: today,
            periodEnd: today,
            totalCost,
            accountCount: course.accounts.length,
            breakdown: {}
          }
        });

        logger.info('Cost snapshot saved', { courseId: course.id, name: course.name, totalCost });
      } catch (err) {
        logger.error('Failed to save cost snapshot', { courseId: course.id, name: course.name, error: err });
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    logger.info('Daily cost snapshot job completed');
  } catch (error) {
    logger.error('Daily cost snapshot job failed', { error });
  }
}

/**
 * 크레딧/코인 현황 일일 갱신 (매일 03:30)
 * 마스터 계정의 크레딧 잔액을 NCP API로 조회하여 DB 캐시 갱신
 */
async function dailyCreditUpdate(): Promise<void> {
  logger.info('Starting daily credit update job');

  try {
    const masterAccounts = await prisma.ncpAccount.findMany({
      where: { isMaster: true, isActive: true },
      select: {
        id: true,
        displayName: true,
        accessKeyEncrypted: true,
        secretKeyEncrypted: true,
        accessKeyHash: true
      }
    });

    // 중복 제거 (같은 NCP 조직 마스터)
    const seen = new Set<string>();
    const unique = masterAccounts.filter(a => {
      const key = a.accessKeyHash || a.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    let success = 0;
    let fail = 0;

    await Promise.allSettled(
      unique.map(async (master) => {
        try {
          const accessKey = decrypt(master.accessKeyEncrypted);
          const secretKey = decrypt(master.secretKeyEncrypted);
          const ncpClient = new NcpClient({ accessKey, secretKey });
          const credit = await ncpClient.billing.getCreditBalance();

          await prisma.ncpAccount.update({
            where: { id: master.id },
            data: { creditData: credit as object, creditUpdatedAt: new Date() }
          });

          logger.info('Credit updated', {
            account: master.displayName,
            remain: credit.remainCredit,
            total: credit.totalCredit
          });
          success++;
        } catch (err) {
          logger.error('Failed to update credit', { account: master.displayName, error: err });
          fail++;
        }
      })
    );

    logger.info('Daily credit update job completed', { success, fail });
  } catch (error) {
    logger.error('Daily credit update job failed', { error });
  }
}

/**
 * 누적 사용료 일일 갱신 (매일 04:00)
 * 모든 과정의 전체 사용료(과정 시작~현재)를 NCP API로 조회하여 DB에 캐시
 */
async function dailyCumulativeCostUpdate(): Promise<void> {
  logger.info('Starting daily cumulative cost update job');

  const toYM = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;

  try {
    const courses = await prisma.course.findMany({
      where: { status: { not: CourseStatus.DRAFT } },
      include: {
        accounts: {
          where: { isActive: true },
          select: { id: true, displayName: true, accessKeyEncrypted: true, secretKeyEncrypted: true, isMaster: true, ncpMemberNo: true }
        }
      }
    });

    let success = 0;
    let fail = 0;

    for (const course of courses) {
      try {
        const masterAccount = course.accounts.find(a => a.isMaster);
        if (!masterAccount) {
          logger.warn('No master account for cumulative cost update', { courseId: course.id, name: course.name });
          fail++;
          continue;
        }

        const startMonth = toYM(new Date(course.startDate));
        const endMonth = toYM(new Date());
        const now = new Date();

        const accessKey = decrypt(masterAccount.accessKeyEncrypted);
        const secretKey = decrypt(masterAccount.secretKeyEncrypted);
        const masterClient = new NcpClient({ accessKey, secretKey });

        // 과정 전체 합계 (org 레벨)
        const orgResult = await masterClient.billing.getCumulativeInvoiceCost(startMonth, endMonth);
        const totalCost = orgResult.invoiceDemandAmount;

        await prisma.course.update({
          where: { id: course.id },
          data: { totalCumulativeCost: totalCost, cumulativeCostUpdatedAt: now }
        });

        // 계정별 누적 비용 저장 (memberNo 있는 계정만, 전체 병렬)
        const subAccountsWithMemberNo = course.accounts.filter(a => !a.isMaster && a.ncpMemberNo);
        const subResults = await Promise.allSettled(
          subAccountsWithMemberNo.map(account =>
            masterClient.billing.getCumulativeInvoiceCost(startMonth, endMonth, [account.ncpMemberNo!])
          )
        );
        await Promise.allSettled(
          subAccountsWithMemberNo.map((account, idx) => {
            const r = subResults[idx];
            if (r.status !== 'fulfilled') return Promise.resolve();
            return prisma.ncpAccount.update({
              where: { id: account.id },
              data: { totalCumulativeCost: r.value.invoiceDemandAmount, cumulativeCostUpdatedAt: now }
            });
          })
        );

        logger.info('Cumulative cost updated', { courseId: course.id, name: course.name, totalCost, accounts: subAccountsWithMemberNo.length });
        success++;
      } catch (err) {
        logger.error('Failed to update cumulative cost', { courseId: course.id, name: course.name, error: err });
        fail++;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    logger.info('Daily cumulative cost update job completed', { success, fail });
  } catch (error) {
    logger.error('Daily cumulative cost update job failed', { error });
  }
}

/**
 * 과정 상태 자동 변경 체크 (매일 00:05)
 * - DRAFT → ACTIVE: 시작일이 도래한 경우
 */
async function checkCourseStatusStart(): Promise<void> {
  logger.info('Starting course status check (DRAFT → ACTIVE) job');

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 시작일이 오늘이거나 지난 DRAFT 과정 조회
    const coursesToActivate = await prisma.course.findMany({
      where: {
        status: CourseStatus.DRAFT,
        startDate: { lte: today }
      }
    });

    for (const course of coursesToActivate) {
      await prisma.course.update({
        where: { id: course.id },
        data: { status: CourseStatus.ACTIVE }
      });

      logger.info('Course automatically activated', {
        courseId: course.id,
        courseName: course.name,
        startDate: course.startDate
      });
    }

    logger.info('Course status check (DRAFT → ACTIVE) job completed', {
      activatedCount: coursesToActivate.length
    });
  } catch (error) {
    logger.error('Course status check (DRAFT → ACTIVE) job failed', { error });
  }
}

/**
 * 종료 과정 자동 정리 체크 (매일 03:00)
 * - ACTIVE → COMPLETED: 종료일이 지난 경우
 */
async function checkEndedCourses(): Promise<void> {
  logger.info('Starting ended courses check job');

  try {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const endedCourses = await prisma.course.findMany({
      where: {
        status: CourseStatus.ACTIVE,
        endDate: { lt: today }
      }
    });

    for (const course of endedCourses) {
      // 과정 상태를 COMPLETED로 변경
      await prisma.course.update({
        where: { id: course.id },
        data: { status: CourseStatus.COMPLETED }
      });

      logger.info('Course marked as completed', {
        courseId: course.id,
        courseName: course.name
      });

      // 자동 정리 작업 생성 (Dry-run으로)
      await prisma.cleanupJob.create({
        data: {
          courseId: course.id,
          isDryRun: true,
          status: CleanupStatus.PENDING
        }
      });

      logger.info('Cleanup job created for ended course', {
        courseId: course.id
      });
    }

    logger.info('Ended courses check job completed', {
      processedCount: endedCourses.length
    });
  } catch (error) {
    logger.error('Ended courses check job failed', { error });
  }
}

/**
 * 예약된 정리 작업 실행 (매 시간)
 */
async function executeScheduledCleanups(): Promise<void> {
  logger.info('Checking for scheduled cleanup jobs');

  try {
    const scheduledJobs = await prisma.cleanupJob.findMany({
      where: {
        status: CleanupStatus.PENDING,
        scheduledAt: { lte: new Date() }
      },
      include: {
        course: {
          include: {
            accounts: {
              where: { isActive: true }
            }
          }
        }
      }
    });

    for (const job of scheduledJobs) {
      if (!job.isDryRun) {
        // 실제 삭제 작업은 대량 데이터 손실 위험 → 스케줄러 자동 실행 금지
        // UI에서 명시적 확인(confirm: 'DELETE_ALL_RESOURCES') 후에만 실행
        logger.warn('Scheduled non-dry-run cleanup skipped — requires manual UI confirmation', {
          jobId: job.id,
          courseId: job.courseId
        });
        continue;
      }

      // isDryRun: true — 리소스 현황 파악 (읽기 전용, 안전)
      logger.info('Executing dry-run cleanup preview', { jobId: job.id });

      await prisma.cleanupJob.update({
        where: { id: job.id },
        data: { status: CleanupStatus.RUNNING, startedAt: new Date() }
      });

      try {
        const resourceSummary: Record<string, number> = {};
        let totalResources = 0;

        for (const account of job.course.accounts) {
          try {
            const accessKey = decrypt(account.accessKeyEncrypted);
            const secretKey = decrypt(account.secretKeyEncrypted);
            const ncpClient = new NcpClient({ accessKey, secretKey });
            const resources = await ncpClient.getAllResources();

            const count =
              resources.servers.count + resources.blockStorages.count +
              resources.nasVolumes.count + resources.loadBalancers.count +
              resources.natGateways.count;

            if (count > 0) {
              resourceSummary[account.displayName || account.id] = count;
              totalResources += count;
            }
          } catch (err) {
            logger.warn('Failed to check resources for account', { accountId: account.id, error: err });
          }
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        await prisma.cleanupJob.update({
          where: { id: job.id },
          data: {
            status: CleanupStatus.COMPLETED,
            completedAt: new Date(),
            summary: { isDryRun: true, totalResources, resourceSummary } as object
          }
        });

        logger.info('Dry-run cleanup preview completed', {
          jobId: job.id,
          courseId: job.courseId,
          totalResources
        });
      } catch (err) {
        await prisma.cleanupJob.update({
          where: { id: job.id },
          data: { status: CleanupStatus.FAILED, completedAt: new Date() }
        });
        logger.error('Dry-run cleanup failed', { jobId: job.id, error: err });
      }
    }
  } catch (error) {
    logger.error('Scheduled cleanup execution failed', { error });
  }
}

/**
 * 리소스 동기화 (매 6시간)
 */
async function syncResources(): Promise<void> {
  logger.info('Starting resource sync job');

  try {
    const accounts = await prisma.ncpAccount.findMany({
      where: {
        isActive: true,
        course: { status: CourseStatus.ACTIVE }
      },
      select: {
        id: true,
        accessKeyEncrypted: true,
        secretKeyEncrypted: true
      }
    });

    for (const account of accounts) {
      try {
        const accessKey = decrypt(account.accessKeyEncrypted);
        const secretKey = decrypt(account.secretKeyEncrypted);

        const ncpClient = new NcpClient({ accessKey, secretKey });
        const resources = await ncpClient.getAllResources();

        // 리소스 정보 업데이트
        await prisma.ncpAccount.update({
          where: { id: account.id },
          data: { lastSyncAt: new Date() }
        });

        logger.debug('Resources synced for account', {
          accountId: account.id,
          serverCount: resources.servers.count
        });
      } catch (err) {
        logger.error('Failed to sync resources for account', {
          accountId: account.id,
          error: err
        });
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    logger.info('Resource sync job completed');
  } catch (error) {
    logger.error('Resource sync job failed', { error });
  }
}

/**
 * 스케줄러 시작
 */
export function startScheduler(): void {
  logger.info('Starting scheduler');

  // 매일 10:00 - 과정 상태 체크 (DRAFT→ACTIVE, ACTIVE→COMPLETED)
  cron.schedule('0 10 * * *', checkCourseStatusStart);
  cron.schedule('0 10 * * *', checkEndedCourses);

  // 매일 10:05 - 크레딧/코인 현황 갱신 (빠름, 먼저 실행)
  cron.schedule('5 10 * * *', dailyCreditUpdate);

  // 매일 10:10 - 일일 비용 스냅샷
  cron.schedule('10 10 * * *', dailyCostSnapshot);

  // 매일 10:20 - 누적 사용료 갱신 (가장 오래 걸림, 마지막 실행)
  cron.schedule('20 10 * * *', dailyCumulativeCostUpdate);

  // 예약된 정리 작업 실행 (매 시간 유지 - 예약 정리는 즉시성 필요)
  cron.schedule('0 * * * *', executeScheduledCleanups);

  // 리소스 동기화 (매일 10:15)
  cron.schedule('15 10 * * *', syncResources);

  logger.info('Scheduler started with following jobs:');
  logger.info('- Course status check (DRAFT↔ACTIVE↔COMPLETED): 10:00');
  logger.info('- Credit/coin update: 10:05');
  logger.info('- Daily cost snapshot: 10:10');
  logger.info('- Resource sync: 10:15');
  logger.info('- Cumulative cost update: 10:20');
  logger.info('- Scheduled cleanup execution: Every hour');
}

// 수동 실행용 export
export {
  checkCourseStatusStart,
  dailyCostSnapshot,
  checkEndedCourses,
  executeScheduledCleanups,
  syncResources,
  dailyCumulativeCostUpdate,
  dailyCreditUpdate
};
