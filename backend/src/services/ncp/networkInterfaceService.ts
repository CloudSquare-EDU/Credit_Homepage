/**
 * NCP Network Interface API 서비스
 * Network Interface 조회 및 삭제
 */

import { NcpApiClient, NcpCredentials, NcpApiResponse } from './ncpApiClient';

const VPC_API_URL = 'https://ncloud.apigw.ntruss.com';

export interface NetworkInterface {
  networkInterfaceNo: string;
  networkInterfaceName: string;
  subnetNo: string;
  deleteOnTermination: boolean;
  isDefault: boolean;
  deviceName: string;
  networkInterfaceStatus: { code: string; codeName: string };
  instanceNo?: string;
  instanceType?: { code: string; codeName: string };
  ip: string;
  secondaryIpList?: string[];
  accessControlGroupNoList: string[];
  createDate: string;
}

export class NcpNetworkInterfaceService extends NcpApiClient {
  constructor(credentials: NcpCredentials) {
    super(credentials);
  }

  /**
   * Network Interface 목록 조회
   */
  async getNetworkInterfaces(subnetNo?: string): Promise<{
    success: boolean;
    interfaces: NetworkInterface[];
    error?: string
  }> {
    let uri = '/vpc/v2/getNetworkInterfaceList?responseFormatType=json';
    if (subnetNo) {
      uri += `&subnetNo=${subnetNo}`;
    }

    const response = await this.request<{
      getNetworkInterfaceListResponse: {
        networkInterfaceList: NetworkInterface[];
      };
    }>(VPC_API_URL, 'GET', uri);

    if (!response.success || !response.data) {
      return { success: true, interfaces: [], error: response.error };
    }

    return {
      success: true,
      interfaces: response.data.getNetworkInterfaceListResponse?.networkInterfaceList || []
    };
  }

  /**
   * Network Interface 삭제
   */
  async deleteNetworkInterface(networkInterfaceNo: string): Promise<NcpApiResponse<unknown>> {
    const uri = `/vpc/v2/deleteNetworkInterface?networkInterfaceNo=${networkInterfaceNo}&responseFormatType=json`;
    return this.request(VPC_API_URL, 'GET', uri);
  }

  /**
   * Network Interface를 인스턴스에서 분리
   */
  async detachNetworkInterface(networkInterfaceNo: string): Promise<NcpApiResponse<unknown>> {
    const uri = `/vpc/v2/detachNetworkInterface?networkInterfaceNo=${networkInterfaceNo}&responseFormatType=json`;
    return this.request(VPC_API_URL, 'GET', uri);
  }
}
