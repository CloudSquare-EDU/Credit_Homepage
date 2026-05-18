/**
 * 자동 정리 컨트롤러
 * 과정 종료 시 리소스 및 서브계정 삭제
 */

import { Response, NextFunction } from 'express';
import { PrismaClient, CleanupStatus } from '@prisma/client';
import { AuthRequest } from '../middlewares/auth';
import { createAuditLog, extractAuditInfo } from '../middlewares/audit';
import { AppError } from '../middlewares/errorHandler';
import { decrypt } from '../utils/encryption';
import { NcpClient } from '../services/ncp';
import logger from '../utils/logger';

const prisma = new PrismaClient();

interface CleanupResult {
  accountId: string;
  displayName: string;
  actions: Array<{
    type: string;
    targetId: string;
    targetName?: string;
    status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
    error?: string;
  }>;
}

/**
 * 정리 작업 생성 (Dry-run 모드)
 */
export const createCleanupJob = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;
    const { isDryRun = true, scheduledAt } = req.body;

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        accounts: { where: { isActive: true } }
      }
    });

    if (!course) {
      throw new AppError('Course not found', 404);
    }

    const job = await prisma.cleanupJob.create({
      data: {
        courseId,
        isDryRun,
        status: scheduledAt ? CleanupStatus.PENDING : CleanupStatus.PENDING,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null
      }
    });

    // 감사 로그
    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'CLEANUP_JOB_CREATE',
      entityType: 'CleanupJob',
      entityId: job.id,
      newValue: { courseId, isDryRun, scheduledAt }
    });

    res.status(201).json({
      success: true,
      data: job
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 정리 작업 미리보기 (Dry-run)
 */
export const previewCleanup = async (
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

    const preview: Array<{
      accountId: string;
      displayName: string;
      resources: {
        servers: number;
        vpcs: number;
        subnets: number;
        natGateways: number;
        blockStorages: number;
        nasVolumes: number;
        loadBalancers: number;
        subAccounts: number;
      };
      error?: string;
    }> = [];

    for (const account of course.accounts) {
      try {
        const accessKey = decrypt(account.accessKeyEncrypted);
        const secretKey = decrypt(account.secretKeyEncrypted);

        const ncpClient = new NcpClient({ accessKey, secretKey });
        const resources = await ncpClient.getAllResources();

        preview.push({
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
          }
        });
      } catch (err) {
        preview.push({
          accountId: account.id,
          displayName: account.displayName || '',
          resources: {
            servers: 0,
            vpcs: 0,
            subnets: 0,
            natGateways: 0,
            blockStorages: 0,
            nasVolumes: 0,
            loadBalancers: 0,
            subAccounts: 0
          },
          error: err instanceof Error ? err.message : 'Unknown error'
        });
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    const totals = preview.reduce(
      (acc, item) => {
        for (const [key, value] of Object.entries(item.resources)) {
          acc[key as keyof typeof acc] += value;
        }
        return acc;
      },
      {
        servers: 0,
        vpcs: 0,
        subnets: 0,
        natGateways: 0,
        blockStorages: 0,
        nasVolumes: 0,
        loadBalancers: 0,
        subAccounts: 0
      }
    );

    res.json({
      success: true,
      data: {
        courseId,
        courseName: course.name,
        accountCount: course.accounts.length,
        totals,
        accounts: preview,
        warning: '이 작업은 되돌릴 수 없습니다. 실행 전 반드시 확인하세요.'
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 정리 작업 실행
 */
export const executeCleanup = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { jobId } = req.params;
    const { confirm } = req.body;

    if (confirm !== 'DELETE_ALL_RESOURCES') {
      throw new AppError('Confirmation required. Send confirm: "DELETE_ALL_RESOURCES"', 400);
    }

    const job = await prisma.cleanupJob.findUnique({
      where: { id: jobId },
      include: {
        course: {
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
        }
      }
    });

    if (!job) {
      throw new AppError('Cleanup job not found', 404);
    }

    if (job.status !== CleanupStatus.PENDING) {
      throw new AppError(`Job is already ${job.status}`, 400);
    }

    // 작업 상태 업데이트
    await prisma.cleanupJob.update({
      where: { id: jobId },
      data: {
        status: CleanupStatus.RUNNING,
        startedAt: new Date()
      }
    });

    const results: CleanupResult[] = [];

    for (const account of job.course.accounts) {
      const accountResult: CleanupResult = {
        accountId: account.id,
        displayName: account.displayName || '',
        actions: []
      };

      try {
        const accessKey = decrypt(account.accessKeyEncrypted);
        const secretKey = decrypt(account.secretKeyEncrypted);

        const ncpClient = new NcpClient({ accessKey, secretKey });

        // 0. NKS 클러스터 삭제 (Kubernetes 노드 서버 자동 삭제)
        const clusters = await ncpClient.nks.getClusters();
        for (const cluster of clusters.clusters) {
          if (job.isDryRun) {
            accountResult.actions.push({
              type: 'DELETE_NKS_CLUSTER',
              targetId: cluster.uuid,
              targetName: cluster.name,
              status: 'SKIPPED'
            });
          } else {
            const result = await ncpClient.nks.deleteCluster(cluster.uuid);
            accountResult.actions.push({
              type: 'DELETE_NKS_CLUSTER',
              targetId: cluster.uuid,
              targetName: cluster.name,
              status: result.success ? 'SUCCESS' : 'FAILED',
              error: result.error
            });

            if (result.success) {
              logger.info(`NKS cluster ${cluster.name} deletion initiated`);
              await new Promise(resolve => setTimeout(resolve, 5000));
            }

            await prisma.cleanupLog.create({
              data: {
                cleanupJobId: jobId,
                ncpAccountId: account.id,
                action: 'DELETE_NKS_CLUSTER',
                targetType: 'NKS_CLUSTER',
                targetId: cluster.uuid,
                targetName: cluster.name,
                status: result.success ? 'SUCCESS' : 'FAILED',
                errorMessage: result.error
              }
            });
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // 0-1. Auto Scaling Group 삭제 (ASG 서버 자동 삭제)
        logger.info(`[ASG] Querying Auto Scaling Groups for account ${account.displayName || account.id}`);
        const asgGroups = await ncpClient.autoScaling.getAutoScalingGroups();
        logger.info(`[ASG] Found ${asgGroups.groups?.length || 0} groups, success: ${asgGroups.success}`);

        if (!asgGroups.success) {
          logger.error(`[ASG] Failed to get Auto Scaling Groups: ${asgGroups.error}`);
        }

        for (const group of asgGroups.groups || []) {
          logger.info(`[ASG] Processing group: ${group.autoScalingGroupName} (${group.autoScalingGroupNo})`);

          if (job.isDryRun) {
            accountResult.actions.push({
              type: 'DELETE_ASG',
              targetId: group.autoScalingGroupNo,
              targetName: group.autoScalingGroupName,
              status: 'SKIPPED'
            });
          } else {
            const result = await ncpClient.autoScaling.deleteAutoScalingGroup(group.autoScalingGroupNo);
            accountResult.actions.push({
              type: 'DELETE_ASG',
              targetId: group.autoScalingGroupNo,
              targetName: group.autoScalingGroupName,
              status: result.success ? 'SUCCESS' : 'FAILED',
              error: result.error
            });

            if (result.success) {
              logger.info(`Auto Scaling Group ${group.autoScalingGroupName} deletion initiated`);
              await new Promise(resolve => setTimeout(resolve, 5000));
            }

            await prisma.cleanupLog.create({
              data: {
                cleanupJobId: jobId,
                ncpAccountId: account.id,
                action: 'DELETE_ASG',
                targetType: 'ASG',
                targetId: group.autoScalingGroupNo,
                targetName: group.autoScalingGroupName,
                status: result.success ? 'SUCCESS' : 'FAILED',
                errorMessage: result.error
              }
            });
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // 1. 서버 삭제 (반납 보호 해제 → 블록 스토리지 분리/삭제 → 정지 → 반납)
        const servers = await ncpClient.server.getVpcServers();
        for (const server of servers.servers) {
          // NKS 노드 서버와 ASG 서버는 스킵 (각 서비스에서 관리됨)
          const isNksNode = server.serverName.includes('-nks-node-');
          const isAsgServer = server.serverName.includes('-asg-');

          if (isNksNode || isAsgServer) {
            logger.info(`Skipping ${isNksNode ? 'NKS node' : 'ASG'} server: ${server.serverName} (managed by ${isNksNode ? 'NKS' : 'Auto Scaling'})`);
            accountResult.actions.push({
              type: 'SKIP_SERVER',
              targetId: server.serverInstanceNo,
              targetName: server.serverName,
              status: 'SKIPPED',
              error: `${isNksNode ? 'NKS 노드 서버' : 'ASG 서버'} - ${isNksNode ? 'NKS 클러스터' : 'Auto Scaling Group'}에서 관리됨`
            });

            await prisma.cleanupLog.create({
              data: {
                cleanupJobId: jobId,
                ncpAccountId: account.id,
                action: 'SKIP_SERVER',
                targetType: 'SERVER',
                targetId: server.serverInstanceNo,
                targetName: server.serverName,
                status: 'SKIPPED',
                errorMessage: `${isNksNode ? 'NKS 노드 서버' : 'ASG 서버'} - ${isNksNode ? 'NKS 클러스터' : 'Auto Scaling Group'}에서 관리됨`
              }
            });
            continue;
          }

          if (job.isDryRun) {
            accountResult.actions.push({
              type: 'DELETE_SERVER',
              targetId: server.serverInstanceNo,
              targetName: server.serverName,
              status: 'SKIPPED'
            });
          } else {
            // 1-1. 반납 보호 해제
            const protectionResult = await ncpClient.server.changeServerProtection(server.serverInstanceNo, false);
            if (!protectionResult.success) {
              logger.warn(`Server ${server.serverName} protection removal failed: ${protectionResult.error}`);
              accountResult.actions.push({
                type: 'REMOVE_PROTECTION',
                targetId: server.serverInstanceNo,
                targetName: server.serverName,
                status: 'FAILED',
                error: `반납 보호 해제 실패: ${protectionResult.error}`
              });
            } else {
              logger.info(`Server ${server.serverName} protection removed successfully`);
            }
            // 보호 해제 반영 대기 시간 증가 (3초)
            await new Promise(resolve => setTimeout(resolve, 3000));

            // 1-2. 추가 블록 스토리지 분리 및 삭제
            const blockStoragesResult = await ncpClient.server.getBlockStorageList(server.serverInstanceNo);
            if (blockStoragesResult.success && blockStoragesResult.blockStorages.length > 0) {
              const additionalStorages = blockStoragesResult.blockStorages.filter(
                bs => bs.blockStorageType.code !== 'BASIC'
              );

              if (additionalStorages.length > 0) {
                const storageNos = additionalStorages.map(bs => bs.blockStorageInstanceNo);
                const detachResult = await ncpClient.server.detachBlockStorage(server.serverInstanceNo, storageNos);
                if (detachResult.success) {
                  await new Promise(resolve => setTimeout(resolve, 3000));
                  await ncpClient.server.deleteBlockStorage(storageNos);
                }
              }
            }

            // 1-3. 실행 중인 서버는 정지
            if (server.serverInstanceStatus.code === 'RUN') {
              const stopResult = await ncpClient.server.stopServer(server.serverInstanceNo);
              if (!stopResult.success) {
                accountResult.actions.push({
                  type: 'DELETE_SERVER',
                  targetId: server.serverInstanceNo,
                  targetName: server.serverName,
                  status: 'FAILED',
                  error: `서버 정지 실패: ${stopResult.error}`
                });
                await new Promise(resolve => setTimeout(resolve, 500));
                continue;
              }
              await new Promise(resolve => setTimeout(resolve, 15000));
            } else if (server.serverInstanceStatus.code === 'NSTOP') {
              await new Promise(resolve => setTimeout(resolve, 10000));
            }

            // 1-4. 서버 반납
            const result = await ncpClient.server.terminateServer(server.serverInstanceNo);
            const logEntry = {
              type: 'DELETE_SERVER',
              targetId: server.serverInstanceNo,
              targetName: server.serverName,
              status: result.success ? 'SUCCESS' as const : 'FAILED' as const,
              error: result.error
            };
            accountResult.actions.push(logEntry);

            // DB 로그 저장
            await prisma.cleanupLog.create({
              data: {
                cleanupJobId: jobId,
                ncpAccountId: account.id,
                action: 'DELETE_SERVER',
                targetType: 'SERVER',
                targetId: server.serverInstanceNo,
                targetName: server.serverName,
                status: logEntry.status,
                errorMessage: logEntry.error
              }
            });
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // 2. 로드밸런서 삭제
        const lbs = await ncpClient.loadBalancer.getLoadBalancerList();
        for (const lb of lbs.loadBalancers) {
          if (job.isDryRun) {
            accountResult.actions.push({
              type: 'DELETE_LOAD_BALANCER',
              targetId: lb.loadBalancerInstanceNo,
              targetName: lb.loadBalancerName,
              status: 'SKIPPED'
            });
          } else {
            const result = await ncpClient.loadBalancer.deleteLoadBalancer(lb.loadBalancerInstanceNo);
            accountResult.actions.push({
              type: 'DELETE_LOAD_BALANCER',
              targetId: lb.loadBalancerInstanceNo,
              targetName: lb.loadBalancerName,
              status: result.success ? 'SUCCESS' : 'FAILED',
              error: result.error
            });

            await prisma.cleanupLog.create({
              data: {
                cleanupJobId: jobId,
                ncpAccountId: account.id,
                action: 'DELETE_LOAD_BALANCER',
                targetType: 'LOAD_BALANCER',
                targetId: lb.loadBalancerInstanceNo,
                targetName: lb.loadBalancerName,
                status: result.success ? 'SUCCESS' : 'FAILED',
                errorMessage: result.error
              }
            });
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // 3. NAT Gateway 삭제 (Route Table 라우트 먼저 삭제)
        const nats = await ncpClient.vpc.getNatGatewayList();
        for (const nat of nats.natGateways) {
          if (job.isDryRun) {
            accountResult.actions.push({
              type: 'DELETE_NAT_GATEWAY',
              targetId: nat.natGatewayInstanceNo,
              targetName: nat.natGatewayName,
              status: 'SKIPPED'
            });
          } else {
            // 3-1. Route Table에서 이 NAT Gateway를 참조하는 라우트 삭제
            logger.info(`Attempting to remove routes for NAT Gateway ${nat.natGatewayName} (standard method)`);
            const removeRoutesResult = await ncpClient.vpc.removeNatGatewayRoutes(nat.natGatewayInstanceNo);

            let totalDeletedRoutes = removeRoutesResult.deletedCount;

            if (removeRoutesResult.deletedCount > 0) {
              logger.info(`Successfully removed ${removeRoutesResult.deletedCount} routes via standard method for ${nat.natGatewayName}`);
            } else {
              logger.info(`No routes found via standard method for ${nat.natGatewayName}, trying force delete...`);

              // 표준 방법으로 route를 찾지 못했다면 강제 삭제 시도 (VPC의 모든 subnet CIDR 포함)
              const forceResult = await ncpClient.vpc.forceRemoveNatGatewayRoutes(nat.natGatewayInstanceNo, nat.natGatewayName, nat.vpcNo);
              totalDeletedRoutes += forceResult.deletedCount;

              if (forceResult.deletedCount > 0) {
                logger.info(`Force deleted ${forceResult.deletedCount} routes for ${nat.natGatewayName}`);
              } else {
                logger.info(`No routes found to delete for ${nat.natGatewayName}`);
              }
            }

            if (totalDeletedRoutes > 0) {
              accountResult.actions.push({
                type: 'REMOVE_ROUTES',
                targetId: nat.natGatewayInstanceNo,
                targetName: nat.natGatewayName,
                status: 'SUCCESS',
                error: `${totalDeletedRoutes}개 라우트 삭제됨`
              });
            }

            // 3-2. NAT Gateway 삭제 (라우트 삭제 반영 대기 시간 증가: 5초)
            await new Promise(resolve => setTimeout(resolve, 5000));
            const result = await ncpClient.vpc.deleteNatGateway(nat.natGatewayInstanceNo);
            accountResult.actions.push({
              type: 'DELETE_NAT_GATEWAY',
              targetId: nat.natGatewayInstanceNo,
              targetName: nat.natGatewayName,
              status: result.success ? 'SUCCESS' : 'FAILED',
              error: result.error
            });

            await prisma.cleanupLog.create({
              data: {
                cleanupJobId: jobId,
                ncpAccountId: account.id,
                action: 'DELETE_NAT_GATEWAY',
                targetType: 'NAT_GATEWAY',
                targetId: nat.natGatewayInstanceNo,
                targetName: nat.natGatewayName,
                status: result.success ? 'SUCCESS' : 'FAILED',
                errorMessage: result.error
              }
            });
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // 4. Subnet 삭제
        const subnets = await ncpClient.vpc.getSubnetList();
        for (const subnet of subnets.subnets) {
          if (job.isDryRun) {
            accountResult.actions.push({
              type: 'DELETE_SUBNET',
              targetId: subnet.subnetNo,
              targetName: subnet.subnetName,
              status: 'SKIPPED'
            });
          } else {
            const result = await ncpClient.vpc.deleteSubnet(subnet.subnetNo);
            accountResult.actions.push({
              type: 'DELETE_SUBNET',
              targetId: subnet.subnetNo,
              targetName: subnet.subnetName,
              status: result.success ? 'SUCCESS' : 'FAILED',
              error: result.error
            });

            await prisma.cleanupLog.create({
              data: {
                cleanupJobId: jobId,
                ncpAccountId: account.id,
                action: 'DELETE_SUBNET',
                targetType: 'SUBNET',
                targetId: subnet.subnetNo,
                targetName: subnet.subnetName,
                status: result.success ? 'SUCCESS' : 'FAILED',
                errorMessage: result.error
              }
            });
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // 5. VPC 삭제
        const vpcs = await ncpClient.vpc.getVpcList();
        for (const vpc of vpcs.vpcs) {
          if (job.isDryRun) {
            accountResult.actions.push({
              type: 'DELETE_VPC',
              targetId: vpc.vpcNo,
              targetName: vpc.vpcName,
              status: 'SKIPPED'
            });
          } else {
            const result = await ncpClient.vpc.deleteVpc(vpc.vpcNo);
            accountResult.actions.push({
              type: 'DELETE_VPC',
              targetId: vpc.vpcNo,
              targetName: vpc.vpcName,
              status: result.success ? 'SUCCESS' : 'FAILED',
              error: result.error
            });

            await prisma.cleanupLog.create({
              data: {
                cleanupJobId: jobId,
                ncpAccountId: account.id,
                action: 'DELETE_VPC',
                targetType: 'VPC',
                targetId: vpc.vpcNo,
                targetName: vpc.vpcName,
                status: result.success ? 'SUCCESS' : 'FAILED',
                errorMessage: result.error
              }
            });
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // 6. 서브계정 삭제
        const subAccounts = await ncpClient.subAccount.getSubAccounts();
        for (const sub of subAccounts.accounts) {
          if (job.isDryRun) {
            accountResult.actions.push({
              type: 'DELETE_SUBACCOUNT',
              targetId: sub.subAccountId,
              targetName: sub.subAccountName,
              status: 'SKIPPED'
            });
          } else {
            const result = await ncpClient.subAccount.deleteSubAccount(sub.subAccountId);
            accountResult.actions.push({
              type: 'DELETE_SUBACCOUNT',
              targetId: sub.subAccountId,
              targetName: sub.subAccountName,
              status: result.success ? 'SUCCESS' : 'FAILED',
              error: result.error
            });

            await prisma.cleanupLog.create({
              data: {
                cleanupJobId: jobId,
                ncpAccountId: account.id,
                action: 'DELETE_SUBACCOUNT',
                targetType: 'SUBACCOUNT',
                targetId: sub.subAccountId,
                targetName: sub.subAccountName,
                status: result.success ? 'SUCCESS' : 'FAILED',
                errorMessage: result.error
              }
            });
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }

      } catch (err) {
        logger.error('Cleanup error for account', {
          accountId: account.id,
          error: err
        });
        accountResult.actions.push({
          type: 'ERROR',
          targetId: account.id,
          status: 'FAILED',
          error: err instanceof Error ? err.message : 'Unknown error'
        });
      }

      results.push(accountResult);
    }

    // 작업 완료 업데이트
    const totalActions = results.reduce((sum, r) => sum + r.actions.length, 0);
    const successActions = results.reduce(
      (sum, r) => sum + r.actions.filter(a => a.status === 'SUCCESS').length,
      0
    );
    const failedActions = results.reduce(
      (sum, r) => sum + r.actions.filter(a => a.status === 'FAILED').length,
      0
    );

    await prisma.cleanupJob.update({
      where: { id: jobId },
      data: {
        status: failedActions > 0 ? CleanupStatus.FAILED : CleanupStatus.COMPLETED,
        completedAt: new Date(),
        summary: {
          totalAccounts: job.course.accounts.length,
          totalActions,
          successActions,
          failedActions,
          skippedActions: totalActions - successActions - failedActions
        }
      }
    });

    // 감사 로그
    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'CLEANUP_JOB_EXECUTE',
      entityType: 'CleanupJob',
      entityId: jobId,
      newValue: { totalActions, successActions, failedActions, isDryRun: job.isDryRun }
    });

    res.json({
      success: true,
      data: {
        jobId,
        isDryRun: job.isDryRun,
        summary: {
          totalAccounts: job.course.accounts.length,
          totalActions,
          successActions,
          failedActions
        },
        results
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 정리 작업 목록
 */
export const listCleanupJobs = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.query;

    const where = courseId ? { courseId: courseId as string } : {};

    const jobs = await prisma.cleanupJob.findMany({
      where,
      include: {
        course: { select: { id: true, name: true } },
        _count: { select: { logs: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: jobs
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 정리 작업 상세
 */
export const getCleanupJob = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { jobId } = req.params;

    const job = await prisma.cleanupJob.findUnique({
      where: { id: jobId },
      include: {
        course: { select: { id: true, name: true } },
        logs: {
          orderBy: { executedAt: 'asc' }
        }
      }
    });

    if (!job) {
      throw new AppError('Cleanup job not found', 404);
    }

    res.json({
      success: true,
      data: job
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 정리 작업 취소
 */
export const cancelCleanupJob = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { jobId } = req.params;

    const job = await prisma.cleanupJob.findUnique({
      where: { id: jobId }
    });

    if (!job) {
      throw new AppError('Cleanup job not found', 404);
    }

    if (job.status !== CleanupStatus.PENDING) {
      throw new AppError(`Cannot cancel job with status ${job.status}`, 400);
    }

    await prisma.cleanupJob.update({
      where: { id: jobId },
      data: { status: CleanupStatus.CANCELLED }
    });

    // 감사 로그
    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'CLEANUP_JOB_CANCEL',
      entityType: 'CleanupJob',
      entityId: jobId
    });

    res.json({
      success: true,
      message: 'Cleanup job cancelled'
    });
  } catch (error) {
    next(error);
  }
};
