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
 */
async function dailyCostSnapshot(): Promise<void> {
  logger.info('Starting daily cost snapshot job');

  try {
    const activeCourses = await prisma.course.findMany({
      where: { status: CourseStatus.ACTIVE },
      include: {
        accounts: {
          where: { isActive: true },
          select: {
            id: true,
            accessKeyEncrypted: true,
            secretKeyEncrypted: true
          }
        }
      }
    });

    for (const course of activeCourses) {
      let totalCost = 0;
      const breakdown: Record<string, number> = {};

      for (const account of course.accounts) {
        try {
          const accessKey = decrypt(account.accessKeyEncrypted);
          const secretKey = decrypt(account.secretKeyEncrypted);

          const ncpClient = new NcpClient({ accessKey, secretKey });
          const services = await ncpClient.billing.getActiveServices();

          for (const service of services.serviceDetails) {
            totalCost += service.cost || 0;
            breakdown[service.serviceName] = (breakdown[service.serviceName] || 0) + (service.cost || 0);
          }
        } catch (err) {
          logger.error('Failed to get cost for account', {
            accountId: account.id,
            error: err
          });
        }

        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // 스냅샷 저장
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      await prisma.costSnapshot.create({
        data: {
          courseId: course.id,
          periodStart: today,
          periodEnd: today,
          totalCost,
          accountCount: course.accounts.length,
          breakdown
        }
      });

      logger.info('Cost snapshot saved', {
        courseId: course.id,
        totalCost
      });
    }

    logger.info('Daily cost snapshot job completed');
  } catch (error) {
    logger.error('Daily cost snapshot job failed', { error });
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
      logger.info('Executing scheduled cleanup job', { jobId: job.id });

      // 여기서 실제 정리 로직 실행
      // cleanupController의 executeCleanup과 유사한 로직

      await prisma.cleanupJob.update({
        where: { id: job.id },
        data: {
          status: CleanupStatus.RUNNING,
          startedAt: new Date()
        }
      });

      // TODO: 실제 정리 로직 구현
      // 현재는 로그만 남김

      await prisma.cleanupJob.update({
        where: { id: job.id },
        data: {
          status: CleanupStatus.COMPLETED,
          completedAt: new Date()
        }
      });

      logger.info('Scheduled cleanup job completed', { jobId: job.id });
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

  // 과정 시작 체크 (매일 00:05) - DRAFT → ACTIVE
  cron.schedule('5 0 * * *', checkCourseStatusStart);

  // 일일 비용 스냅샷 (매일 02:00)
  cron.schedule('0 2 * * *', dailyCostSnapshot);

  // 종료 과정 체크 (매일 03:00) - ACTIVE → COMPLETED
  cron.schedule('0 3 * * *', checkEndedCourses);

  // 예약된 정리 작업 실행 (매 시간)
  cron.schedule('0 * * * *', executeScheduledCleanups);

  // 리소스 동기화 (매 6시간)
  cron.schedule('0 */6 * * *', syncResources);

  logger.info('Scheduler started with following jobs:');
  logger.info('- Course status check (DRAFT → ACTIVE): 00:05');
  logger.info('- Daily cost snapshot: 02:00');
  logger.info('- Ended courses check (ACTIVE → COMPLETED): 03:00');
  logger.info('- Scheduled cleanup execution: Every hour');
  logger.info('- Resource sync: Every 6 hours');
}

// 수동 실행용 export
export {
  checkCourseStatusStart,
  dailyCostSnapshot,
  checkEndedCourses,
  executeScheduledCleanups,
  syncResources
};
