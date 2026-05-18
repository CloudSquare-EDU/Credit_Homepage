/**
 * NCP API 서비스 통합 모듈
 */

export * from './ncpApiClient';
export * from './billingService';
export * from './subAccountService';
export * from './serverService';
export * from './vpcService';
export * from './storageService';
export * from './loadBalancerService';
export * from './nksService';
export * from './autoScalingService';
export * from './cloudFunctionService';
export * from './networkInterfaceService';
export * from './snapshotService';

import { NcpCredentials } from './ncpApiClient';
import { NcpBillingService } from './billingService';
import { NcpSubAccountService } from './subAccountService';
import { NcpServerService } from './serverService';
import { NcpVpcService } from './vpcService';
import { NcpStorageService } from './storageService';
import { NcpLoadBalancerService } from './loadBalancerService';
import { NcpNksService } from './nksService';
import { NcpAutoScalingService } from './autoScalingService';
import { NcpCloudFunctionService } from './cloudFunctionService';
import { NcpNetworkInterfaceService } from './networkInterfaceService';
import { NcpSnapshotService } from './snapshotService';

/**
 * 모든 NCP 서비스를 포함하는 통합 클라이언트
 */
export class NcpClient {
  public billing: NcpBillingService;
  public subAccount: NcpSubAccountService;
  public server: NcpServerService;
  public vpc: NcpVpcService;
  public storage: NcpStorageService;
  public loadBalancer: NcpLoadBalancerService;
  public nks: NcpNksService;
  public autoScaling: NcpAutoScalingService;
  public cloudFunction: NcpCloudFunctionService;
  public networkInterface: NcpNetworkInterfaceService;
  public snapshot: NcpSnapshotService;

  constructor(credentials: NcpCredentials) {
    this.billing = new NcpBillingService(credentials);
    this.subAccount = new NcpSubAccountService(credentials);
    this.server = new NcpServerService(credentials);
    this.vpc = new NcpVpcService(credentials);
    this.storage = new NcpStorageService(credentials);
    this.loadBalancer = new NcpLoadBalancerService(credentials);
    this.nks = new NcpNksService(credentials);
    this.autoScaling = new NcpAutoScalingService(credentials);
    this.cloudFunction = new NcpCloudFunctionService(credentials);
    this.networkInterface = new NcpNetworkInterfaceService(credentials);
    this.snapshot = new NcpSnapshotService(credentials);
  }

  /**
   * 모든 리소스 조회 (서브계정 제외 - 서브계정은 별도 API로 조회)
   */
  async getAllResources(): Promise<{
    servers: { count: number; items: unknown[] };
    vpcs: { count: number; items: unknown[] };
    subnets: { count: number; items: unknown[] };
    natGateways: { count: number; items: unknown[] };
    blockStorages: { count: number; items: unknown[] };
    nasVolumes: { count: number; items: unknown[] };
    loadBalancers: { count: number; items: unknown[] };
    targetGroups: { count: number; items: unknown[] };
  }> {
    const [
      serversResult,
      vpcsResult,
      subnetsResult,
      natResult,
      blockResult,
      nasResult,
      lbResult,
      tgResult
    ] = await Promise.all([
      this.server.getVpcServers(),
      this.vpc.getVpcList(),
      this.vpc.getSubnetList(),
      this.vpc.getNatGatewayList(),
      this.storage.getBlockStorageList(),
      this.storage.getNasVolumeList(),
      this.loadBalancer.getLoadBalancerList(),
      this.loadBalancer.getTargetGroupList()
    ]);

    return {
      servers: { count: serversResult.count, items: serversResult.servers },
      vpcs: { count: vpcsResult.vpcs.length, items: vpcsResult.vpcs },
      subnets: { count: subnetsResult.subnets.length, items: subnetsResult.subnets },
      natGateways: { count: natResult.natGateways.length, items: natResult.natGateways },
      blockStorages: { count: blockResult.storages.length, items: blockResult.storages },
      nasVolumes: { count: nasResult.volumes.length, items: nasResult.volumes },
      loadBalancers: { count: lbResult.loadBalancers.length, items: lbResult.loadBalancers },
      targetGroups: { count: tgResult.targetGroups.length, items: tgResult.targetGroups }
    };
  }
}
