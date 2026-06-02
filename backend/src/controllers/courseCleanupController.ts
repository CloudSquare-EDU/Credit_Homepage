/**
 * 과정 리소스 정리 컨트롤러
 * 서버, 로드밸런서, NAT Gateway, 서브계정 등 순서대로 삭제
 */

import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middlewares/auth';
import { createAuditLog, extractAuditInfo } from '../middlewares/audit';
import { AppError } from '../middlewares/errorHandler';
import { decrypt } from '../utils/encryption';
import { NcpClient } from '../services/ncp';
import logger from '../utils/logger';

const prisma = new PrismaClient();

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

// 서버 STOPPED 상태 폴링 (최대 maxMs)
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

// 지정 서버들이 목록에서 사라질 때까지 폴링 (최대 maxMs)
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

/**
 * 선택된 계정들의 리소스 일괄 삭제
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

    const accounts = await prisma.ncpAccount.findMany({
      where: { courseId, id: { in: accountIds }, isActive: true },
      select: { id: true, displayName: true, accessKeyEncrypted: true, secretKeyEncrypted: true, accessKeyHash: true }
    });

    if (accounts.length === 0) {
      res.json({ success: true, data: { total: 0, results: [], summary: { totalActions: 0, successActions: 0, failedActions: 0 } } });
      return;
    }

    const results: AccountCleanupResult[] = [];

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
            if (result.success) { logger.info(`[NKS ${clusterIndex}/${totalClusters}] ✓ ${cluster.name} deletion initiated`); await new Promise(r => setTimeout(r, 10000)); }
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
            if (result.success) { logger.info(`[ASG ${asgIndex}/${totalAsgs}] ✓ ${group.autoScalingGroupName} deleted`); await new Promise(r => setTimeout(r, 5000)); }
            else logger.error(`[ASG ${asgIndex}/${totalAsgs}] ✗ ${group.autoScalingGroupName}: ${result.error}`);
          }
          await new Promise(r => setTimeout(r, 500));
        }

        // 1. 로드밸런서 삭제
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

        // 1-1. Target Group 삭제
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

        // 3. 서버 삭제
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
            accountResult.actions.push({ type: 'SKIP_SERVER', targetId: server.serverInstanceNo, targetName: server.serverName, status: 'SKIPPED', error: `${isNksNode ? 'NKS 노드' : 'ASG'} 서버 — 각 서비스에서 관리됨` });
            continue;
          }
          if (isDryRun) { accountResult.actions.push({ type: 'DELETE_SERVER', targetId: server.serverInstanceNo, targetName: server.serverName, status: 'SKIPPED' }); continue; }

          // 3-1. 반납 보호 해제
          const protectionResult = await ncpClient.server.changeServerProtection(server.serverInstanceNo, false);
          if (!protectionResult.success) accountResult.actions.push({ type: 'REMOVE_PROTECTION', targetId: server.serverInstanceNo, targetName: server.serverName, status: 'FAILED', error: protectionResult.error });
          await new Promise(r => setTimeout(r, 2000));

          // 3-2. Public IP 분리
          const pipList = await ncpClient.server.getPublicIpList();
          const attachedPips = pipList.publicIps.filter(ip => ip.serverInstanceAssociatedWithPublicIp?.serverInstanceNo === server.serverInstanceNo);
          for (const pip of attachedPips) {
            const disResult = await ncpClient.server.disassociatePublicIp(pip.publicIpInstanceNo);
            if (disResult.success) await new Promise(r => setTimeout(r, 1000));
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
                if (!deleteResult.success) accountResult.actions.push({ type: 'DELETE_STORAGE', targetId: storageNos.join(','), targetName: `${server.serverName} storages`, status: 'FAILED', error: deleteResult.error });
              } else {
                accountResult.actions.push({ type: 'DETACH_STORAGE', targetId: server.serverInstanceNo, targetName: server.serverName, status: 'FAILED', error: detachResult.error });
              }
            }
          }

          // 3-4. 서버 정지 → STOPPED 폴링
          const currentStatus = server.serverInstanceStatus.code;
          if (currentStatus === 'RUN') {
            const stopResult = await ncpClient.server.stopServer(server.serverInstanceNo);
            if (!stopResult.success) { accountResult.actions.push({ type: 'DELETE_SERVER', targetId: server.serverInstanceNo, targetName: server.serverName, status: 'FAILED', error: `서버 정지 실패: ${stopResult.error}` }); continue; }
            const stopped = await pollUntilStopped(ncpClient, server.serverInstanceNo, 120000);
            if (!stopped) { accountResult.actions.push({ type: 'DELETE_SERVER', targetId: server.serverInstanceNo, targetName: server.serverName, status: 'FAILED', error: '서버 정지 타임아웃 (120초)' }); continue; }
          } else if (currentStatus === 'NSTOP') {
            const stopped = await pollUntilStopped(ncpClient, server.serverInstanceNo, 120000);
            if (!stopped) { accountResult.actions.push({ type: 'DELETE_SERVER', targetId: server.serverInstanceNo, targetName: server.serverName, status: 'FAILED', error: '서버 정지 타임아웃 (120초)' }); continue; }
          }

          // 3-5. 서버 반납
          const terminateResult = await ncpClient.server.terminateServer(server.serverInstanceNo);
          accountResult.actions.push({ type: 'DELETE_SERVER', targetId: server.serverInstanceNo, targetName: server.serverName, status: terminateResult.success ? 'SUCCESS' : 'FAILED', error: terminateResult.error });
          if (terminateResult.success) terminatedServerNos.push(server.serverInstanceNo);
          await new Promise(r => setTimeout(r, 1000));
        }

        // 3-6. 모든 서버 반납 완료 대기
        if (terminatedServerNos.length > 0 && !isDryRun) {
          await pollUntilTerminated(ncpClient, terminatedServerNos, 300000);
        }

        // 4. Network Interface 삭제
        const networkInterfaces = await ncpClient.networkInterface.getNetworkInterfaces();
        const totalNics = networkInterfaces.interfaces.length;
        logger.info(`[NETWORK_INTERFACE] Found ${totalNics} network interfaces`);
        let nicIndex = 0;
        for (const nic of networkInterfaces.interfaces) {
          nicIndex++;
          if (nic.isDefault) continue;
          if (isDryRun) { accountResult.actions.push({ type: 'DELETE_NETWORK_INTERFACE', targetId: nic.networkInterfaceNo, targetName: nic.networkInterfaceName, status: 'SKIPPED' }); continue; }
          if (nic.instanceNo) {
            const detachResult = await ncpClient.networkInterface.detachNetworkInterface(nic.networkInterfaceNo);
            if (detachResult.success) await new Promise(r => setTimeout(r, 2000));
          }
          let nicResult, nicRetry = 0;
          while (nicRetry < 3) { nicResult = await ncpClient.networkInterface.deleteNetworkInterface(nic.networkInterfaceNo); if (nicResult.success) break; nicRetry++; if (nicRetry < 3) await new Promise(r => setTimeout(r, 2000 * nicRetry)); }
          accountResult.actions.push({ type: 'DELETE_NETWORK_INTERFACE', targetId: nic.networkInterfaceNo, targetName: nic.networkInterfaceName, status: nicResult.success ? 'SUCCESS' : 'FAILED', error: nicResult.error });
          if (nicResult.success) logger.info(`[NETWORK_INTERFACE ${nicIndex}/${totalNics}] ✓ ${nic.networkInterfaceName} deleted`);
          await new Promise(r => setTimeout(r, 500));
        }

        // 5. Public IP 삭제
        const publicIps = await ncpClient.server.getPublicIpList();
        const totalPublicIps = publicIps.publicIps.length;
        logger.info(`[PUBLIC_IP] Found ${totalPublicIps} public IPs`);
        let publicIpIndex = 0;
        for (const publicIp of publicIps.publicIps) {
          publicIpIndex++;
          if (isDryRun) { accountResult.actions.push({ type: 'DELETE_PUBLIC_IP', targetId: publicIp.publicIpInstanceNo, targetName: publicIp.publicIp, status: 'SKIPPED' }); continue; }
          if (publicIp.serverInstanceAssociatedWithPublicIp) {
            const disResult = await ncpClient.server.disassociatePublicIp(publicIp.publicIpInstanceNo);
            if (disResult.success) await new Promise(r => setTimeout(r, 1000));
          }
          const pipResult = await ncpClient.server.deletePublicIp(publicIp.publicIpInstanceNo);
          accountResult.actions.push({ type: 'DELETE_PUBLIC_IP', targetId: publicIp.publicIpInstanceNo, targetName: publicIp.publicIp, status: pipResult.success ? 'SUCCESS' : 'FAILED', error: pipResult.error });
          if (pipResult.success) logger.info(`[PUBLIC_IP ${publicIpIndex}/${totalPublicIps}] ✓ ${publicIp.publicIp} deleted`);
          await new Promise(r => setTimeout(r, 500));
        }

        // 6. NAT Gateway 삭제
        const nats = await ncpClient.vpc.getNatGatewayList();
        const totalNats = nats.natGateways.length;
        logger.info(`[NAT_GATEWAY] Found ${totalNats} NAT gateways`);
        let natIndex = 0;
        for (const nat of nats.natGateways) {
          natIndex++;
          if (isDryRun) { accountResult.actions.push({ type: 'DELETE_NAT_GATEWAY', targetId: nat.natGatewayInstanceNo, targetName: nat.natGatewayName, status: 'SKIPPED' }); continue; }
          const removeRoutesResult = await ncpClient.vpc.removeNatGatewayRoutes(nat.natGatewayInstanceNo);
          let totalDeletedRoutes = removeRoutesResult.deletedCount;
          if (totalDeletedRoutes === 0) { const forceResult = await ncpClient.vpc.forceRemoveNatGatewayRoutes(nat.natGatewayInstanceNo, nat.natGatewayName, nat.vpcNo); totalDeletedRoutes += forceResult.deletedCount; }
          if (totalDeletedRoutes > 0) accountResult.actions.push({ type: 'REMOVE_ROUTES', targetId: nat.natGatewayInstanceNo, targetName: nat.natGatewayName, status: 'SUCCESS', error: `${totalDeletedRoutes}개 라우트 삭제됨` });
          await new Promise(r => setTimeout(r, 5000));
          let natResult, natRetry = 0;
          while (natRetry < 3) { natResult = await ncpClient.vpc.deleteNatGateway(nat.natGatewayInstanceNo); if (natResult.success) break; natRetry++; if (natRetry < 3) await new Promise(r => setTimeout(r, 3000 * natRetry)); }
          accountResult.actions.push({ type: 'DELETE_NAT_GATEWAY', targetId: nat.natGatewayInstanceNo, targetName: nat.natGatewayName, status: natResult.success ? 'SUCCESS' : 'FAILED', error: natResult.error });
          if (natResult.success) logger.info(`[NAT_GATEWAY ${natIndex}/${totalNats}] ✓ ${nat.natGatewayName} deleted`);
          await new Promise(r => setTimeout(r, 300));
        }

        // 7. VPC Endpoint 삭제
        const endpoints = await ncpClient.vpc.getVpcEndpoints();
        logger.info(`[VPC_ENDPOINT] Found ${endpoints.endpoints.length} VPC endpoints`);
        let endpointIndex = 0;
        for (const endpoint of endpoints.endpoints) {
          endpointIndex++;
          if (isDryRun) { accountResult.actions.push({ type: 'DELETE_VPC_ENDPOINT', targetId: endpoint.vpcEndpointInstanceNo, targetName: endpoint.vpcEndpointName, status: 'SKIPPED' }); continue; }
          const epResult = await ncpClient.vpc.deleteVpcEndpoint(endpoint.vpcEndpointInstanceNo);
          accountResult.actions.push({ type: 'DELETE_VPC_ENDPOINT', targetId: endpoint.vpcEndpointInstanceNo, targetName: endpoint.vpcEndpointName, status: epResult.success ? 'SUCCESS' : 'FAILED', error: epResult.error });
          if (epResult.success) logger.info(`[VPC_ENDPOINT ${endpointIndex}/${endpoints.endpoints.length}] ✓ ${endpoint.vpcEndpointName} deleted`);
          await new Promise(r => setTimeout(r, 500));
        }

        // 8. Snapshot 삭제
        const snapshots = await ncpClient.snapshot.getSnapshotList();
        logger.info(`[SNAPSHOT] Found ${snapshots.snapshots.length} snapshots`);
        let snapshotIndex = 0;
        for (const snapshot of snapshots.snapshots) {
          snapshotIndex++;
          if (isDryRun) { accountResult.actions.push({ type: 'DELETE_SNAPSHOT', targetId: snapshot.blockStorageSnapshotInstanceNo, targetName: snapshot.blockStorageSnapshotName, status: 'SKIPPED' }); continue; }
          const snapResult = await ncpClient.snapshot.deleteSnapshot(snapshot.blockStorageSnapshotInstanceNo);
          let snapStatus: 'SUCCESS' | 'FAILED' | 'MANUAL_REQUIRED' = snapResult.success ? 'SUCCESS' : 'FAILED';
          let snapError = snapResult.error;
          if (!snapResult.success && snapResult.error?.includes('in use by the server image')) { snapStatus = 'MANUAL_REQUIRED'; snapError = 'Snapshot is used by server image. Delete server image first via NCP Console.'; }
          accountResult.actions.push({ type: 'DELETE_SNAPSHOT', targetId: snapshot.blockStorageSnapshotInstanceNo, targetName: snapshot.blockStorageSnapshotName, status: snapStatus, error: snapError });
          if (snapResult.success) logger.info(`[SNAPSHOT ${snapshotIndex}/${snapshots.snapshots.length}] ✓ deleted`);
          await new Promise(r => setTimeout(r, 500));
        }

        // 9. Server Image — API 미지원
        const serverImages = await ncpClient.snapshot.getServerImageList();
        if (serverImages.serverImages.length > 0) {
          accountResult.actions.push({ type: 'DELETE_SERVER_IMAGE_BULK', targetId: 'manual-required', targetName: `${serverImages.serverImages.length} server images`, status: 'MANUAL_REQUIRED', error: 'NCP API does not support server image deletion. Please delete manually via NCP Console.' });
        }

        // 10. Subnet 삭제
        const subnets = await ncpClient.vpc.getSubnetList();
        logger.info(`[SUBNET] Found ${subnets.subnets.length} subnets`);
        let subnetIndex = 0;
        for (const subnet of subnets.subnets) {
          subnetIndex++;
          if (isDryRun) { accountResult.actions.push({ type: 'DELETE_SUBNET', targetId: subnet.subnetNo, targetName: subnet.subnetName, status: 'SKIPPED' }); continue; }
          let subnetResult, subnetRetry = 0;
          while (subnetRetry < 5) { subnetResult = await ncpClient.vpc.deleteSubnet(subnet.subnetNo); if (subnetResult.success) break; subnetRetry++; if (subnetRetry < 5) await new Promise(r => setTimeout(r, 3000 * subnetRetry)); }
          accountResult.actions.push({ type: 'DELETE_SUBNET', targetId: subnet.subnetNo, targetName: subnet.subnetName, status: subnetResult.success ? 'SUCCESS' : 'FAILED', error: subnetResult.error });
          if (subnetResult.success) logger.info(`[SUBNET ${subnetIndex}/${subnets.subnets.length}] ✓ ${subnet.subnetName} deleted`);
          await new Promise(r => setTimeout(r, 1000));
        }

        // 11. VPC Peering — API 미지원
        const peerings = await ncpClient.vpc.getVpcPeeringList();
        for (const peering of peerings.peerings) {
          accountResult.actions.push({ type: 'DELETE_VPC_PEERING', targetId: peering.vpcPeeringInstanceNo, targetName: peering.vpcPeeringName, status: 'MANUAL_REQUIRED', error: 'NCP API does not support VPC peering deletion. Please delete manually via NCP Console.' });
        }

        // 12. VPC 삭제
        const vpcs = await ncpClient.vpc.getVpcList();
        logger.info(`[VPC] Found ${vpcs.vpcs.length} VPCs`);
        let vpcIndex = 0;
        for (const vpc of vpcs.vpcs) {
          vpcIndex++;
          if (isDryRun) { accountResult.actions.push({ type: 'DELETE_VPC', targetId: vpc.vpcNo, targetName: vpc.vpcName, status: 'SKIPPED' }); continue; }
          let vpcResult, vpcRetry = 0;
          while (vpcRetry < 5) { vpcResult = await ncpClient.vpc.deleteVpc(vpc.vpcNo); if (vpcResult.success) break; vpcRetry++; if (vpcRetry < 5) await new Promise(r => setTimeout(r, 2000 * vpcRetry)); }
          accountResult.actions.push({ type: 'DELETE_VPC', targetId: vpc.vpcNo, targetName: vpc.vpcName, status: vpcResult.success ? 'SUCCESS' : 'FAILED', error: vpcResult.error });
          if (vpcResult.success) logger.info(`[VPC ${vpcIndex}/${vpcs.vpcs.length}] ✓ ${vpc.vpcName} deleted`);
          await new Promise(r => setTimeout(r, 1500));
        }

        // 13. 서브계정 삭제
        const subAccounts = await ncpClient.subAccount.getSubAccounts();
        logger.info(`[SUBACCOUNT] Found ${subAccounts.accounts.length} sub-accounts`);
        let subIndex = 0;
        for (const sub of subAccounts.accounts) {
          subIndex++;
          if (isDryRun) { accountResult.actions.push({ type: 'DELETE_SUBACCOUNT', targetId: sub.subAccountId, targetName: sub.subAccountName, status: 'SKIPPED' }); continue; }
          const subResult = await ncpClient.subAccount.deleteSubAccount(sub.subAccountId);
          accountResult.actions.push({ type: 'DELETE_SUBACCOUNT', targetId: sub.subAccountId, targetName: sub.subAccountName, status: subResult.success ? 'SUCCESS' : 'FAILED', error: subResult.error });
          if (subResult.success) {
            logger.info(`[SUBACCOUNT ${subIndex}/${subAccounts.accounts.length}] ✓ ${sub.subAccountName} deleted`);
            await prisma.subAccount.deleteMany({ where: { ncpAccountId: account.id, subAccountId: sub.subAccountId } });
          }
          await new Promise(r => setTimeout(r, 100));
        }

        accountResult.success = accountResult.actions.every(a => a.status !== 'FAILED');
      } catch (err) {
        accountResult.success = false;
        accountResult.error = err instanceof Error ? err.message : '알 수 없는 오류';
      }

      results.push(accountResult);
    }

    const summary = {
      totalAccounts: accounts.length,
      totalActions: results.reduce((sum, r) => sum + r.actions.length, 0),
      successActions: results.reduce((sum, r) => sum + r.actions.filter(a => a.status === 'SUCCESS').length, 0),
      failedActions: results.reduce((sum, r) => sum + r.actions.filter(a => a.status === 'FAILED').length, 0),
      skippedActions: results.reduce((sum, r) => sum + r.actions.filter(a => a.status === 'SKIPPED').length, 0),
      manualRequiredActions: results.reduce((sum, r) => sum + r.actions.filter(a => a.status === 'MANUAL_REQUIRED').length, 0)
    };

    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'COURSE_BULK_CLEANUP',
      entityType: 'Course',
      entityId: courseId,
      newValue: { accountIds, isDryRun, ...summary }
    });

    res.json({ success: true, data: { isDryRun, total: accounts.length, results, summary } });
  } catch (error) {
    next(error);
  }
};
