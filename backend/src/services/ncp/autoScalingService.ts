/**
 * NCP Auto Scaling API 서비스
 * Auto Scaling Group 조회 및 삭제
 */

import { NcpApiClient, NcpCredentials, NcpApiResponse } from './ncpApiClient';

const AUTOSCALING_API_URL = 'https://ncloud.apigw.ntruss.com';

export interface AutoScalingGroup {
  autoScalingGroupNo: string;
  autoScalingGroupName: string;
  launchConfigurationNo: string;
  desiredCapacity: number;
  minSize: number;
  maxSize: number;
  defaultCooldown: number;
  healthCheckGracePeriod: number;
  healthCheckTypeCode: string;
  createDate: string;
}

export class NcpAutoScalingService extends NcpApiClient {
  constructor(credentials: NcpCredentials) {
    super(credentials);
  }

  /**
   * Auto Scaling Group 목록 조회
   */
  async getAutoScalingGroups(): Promise<{ success: boolean; groups: AutoScalingGroup[]; error?: string }> {
    const uri = '/autoscaling/v2/getAutoScalingGroupList?responseFormatType=json';
    const response = await this.request<{ autoScalingGroupList: AutoScalingGroup[] }>(
      AUTOSCALING_API_URL,
      'GET',
      uri
    );

    if (!response.success || !response.data) {
      return { success: false, groups: [], error: response.error };
    }

    return {
      success: true,
      groups: response.data.autoScalingGroupList || []
    };
  }

  /**
   * Auto Scaling Group 삭제
   */
  async deleteAutoScalingGroup(autoScalingGroupNo: string): Promise<NcpApiResponse<unknown>> {
    const uri = `/autoscaling/v2/deleteAutoScalingGroup?autoScalingGroupNo=${autoScalingGroupNo}&responseFormatType=json`;
    return this.request(AUTOSCALING_API_URL, 'POST', uri);
  }
}
