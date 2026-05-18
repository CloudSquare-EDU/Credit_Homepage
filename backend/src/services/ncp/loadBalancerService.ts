/**
 * NCP Load Balancer API 서비스
 * Load Balancer 리소스 조회 및 삭제
 */

import { NcpApiClient, NcpCredentials, NcpApiResponse } from './ncpApiClient';

const LB_API_URL = 'https://ncloud.apigw.ntruss.com';

export interface LoadBalancerInstance {
  loadBalancerInstanceNo: string;
  loadBalancerName: string;
  loadBalancerType: { code: string; codeName: string };
  loadBalancerNetworkType: { code: string; codeName: string };
  throughputType: { code: string; codeName: string };
  loadBalancerInstanceStatus: { code: string; codeName: string };
  vpcNo: string;
  subnetNoList: string[];
  createDate: string;
  loadBalancerDomain?: string;
}

export interface LoadBalancerListResponse {
  getLoadBalancerInstanceListResponse: {
    totalRows: number;
    loadBalancerInstanceList: LoadBalancerInstance[];
  };
}

export interface TargetGroupInstance {
  targetGroupNo: string;
  targetGroupName: string;
  targetType: { code: string; codeName: string };
  vpcNo: string;
  targetGroupProtocolType: { code: string; codeName: string };
  targetGroupPort: number;
  isProxyProtocol: boolean;
  targetGroupHealthCheckTargetGroupPort: number;
  createDate: string;
}

export interface TargetGroupListResponse {
  getTargetGroupListResponse: {
    totalRows: number;
    targetGroupList: TargetGroupInstance[];
  };
}

export class NcpLoadBalancerService extends NcpApiClient {
  constructor(credentials: NcpCredentials) {
    super(credentials);
  }

  /**
   * Load Balancer 목록 조회
   */
  async getLoadBalancerList(): Promise<{
    success: boolean;
    loadBalancers: LoadBalancerInstance[];
    error?: string;
  }> {
    const uri = '/vloadbalancer/v2/getLoadBalancerInstanceList?responseFormatType=json';
    const response = await this.request<LoadBalancerListResponse>(LB_API_URL, 'GET', uri);

    if (!response.success || !response.data) {
      return { success: false, loadBalancers: [], error: response.error };
    }

    return {
      success: true,
      loadBalancers: response.data.getLoadBalancerInstanceListResponse?.loadBalancerInstanceList || []
    };
  }

  /**
   * Target Group 목록 조회
   */
  async getTargetGroupList(): Promise<{
    success: boolean;
    targetGroups: TargetGroupInstance[];
    error?: string;
  }> {
    const uri = '/vloadbalancer/v2/getTargetGroupList?responseFormatType=json';
    const response = await this.request<TargetGroupListResponse>(LB_API_URL, 'GET', uri);

    if (!response.success || !response.data) {
      return { success: false, targetGroups: [], error: response.error };
    }

    return {
      success: true,
      targetGroups: response.data.getTargetGroupListResponse?.targetGroupList || []
    };
  }

  /**
   * Load Balancer 삭제
   */
  async deleteLoadBalancer(loadBalancerInstanceNo: string): Promise<NcpApiResponse<unknown>> {
    const uri = `/vloadbalancer/v2/deleteLoadBalancerInstances?loadBalancerInstanceNoList.1=${loadBalancerInstanceNo}&responseFormatType=json`;
    return this.request(LB_API_URL, 'GET', uri);
  }

  /**
   * Target Group 삭제
   */
  async deleteTargetGroup(targetGroupNo: string): Promise<NcpApiResponse<unknown>> {
    const uri = `/vloadbalancer/v2/deleteTargetGroups?targetGroupNoList.1=${targetGroupNo}&responseFormatType=json`;
    return this.request(LB_API_URL, 'GET', uri);
  }
}
