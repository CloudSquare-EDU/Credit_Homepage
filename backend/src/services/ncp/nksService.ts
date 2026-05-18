/**
 * NCP NKS (Kubernetes) API 서비스
 * NKS 클러스터 조회 및 삭제
 */

import { NcpApiClient, NcpCredentials, NcpApiResponse } from './ncpApiClient';

const NKS_API_URL = 'https://ncloud.apigw.ntruss.com';

export interface NksCluster {
  uuid: string;
  name: string;
  clusterType: string;
  k8sVersion: string;
  regionCode: string;
  vpcNo: string;
  subnetNoList: string[];
  status: string;
  createdAt: string;
}

export interface NksClusterListResponse {
  clusters: NksCluster[];
}

export class NcpNksService extends NcpApiClient {
  constructor(credentials: NcpCredentials) {
    super(credentials);
  }

  /**
   * NKS 클러스터 목록 조회
   */
  async getClusters(): Promise<{ success: boolean; clusters: NksCluster[]; error?: string }> {
    // NCP NKS API는 여러 가능한 엔드포인트 패턴을 시도
    const possibleEndpoints = [
      '/vnks/v2/getClusterList?responseFormatType=json',
      '/nks/v2/getClusterList?responseFormatType=json',
      '/vnks/v2/getClusters?responseFormatType=json',
      '/nks/v2/getClusters?responseFormatType=json'
    ];

    let lastError = '';

    for (const uri of possibleEndpoints) {
      console.log(`[NKS] Trying endpoint: ${uri}`);
      const response = await this.request<{ clusters: NksCluster[] }>(NKS_API_URL, 'GET', uri);

      if (response.success && response.data) {
        console.log(`[NKS] Success with endpoint: ${uri}`);
        return {
          success: true,
          clusters: response.data.clusters || []
        };
      }

      lastError = response.error || 'Unknown error';
      console.log(`[NKS] Failed with endpoint: ${uri}, error: ${lastError}`);
    }

    return { success: false, clusters: [], error: lastError };
  }

  /**
   * NKS 클러스터 삭제
   */
  async deleteCluster(uuid: string): Promise<NcpApiResponse<unknown>> {
    const uri = `/vnks/v2/deleteCluster?uuid=${uuid}&responseFormatType=json`;
    return this.request(NKS_API_URL, 'POST', uri);
  }
}

