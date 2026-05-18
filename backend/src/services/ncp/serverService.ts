/**
 * NCP Server API 서비스
 * VPC/Classic 서버 조회 및 삭제
 */

import { NcpApiClient, NcpCredentials, NcpApiResponse } from './ncpApiClient';

const VPC_SERVER_API_URL = 'https://ncloud.apigw.ntruss.com';

export interface ServerInstance {
  serverInstanceNo: string;
  serverName: string;
  serverInstanceStatus: {
    code: string;
    codeName: string;
  };
  serverInstanceStatusName: string;
  publicIp?: string;
  privateIp?: string;
  serverImageProductCode: string;
  serverProductCode: string;
  zoneCode?: string;
  regionCode?: string;
  vpcNo?: string;
  subnetNo?: string;
  createDate: string;
  uptime: string;
  serverInstanceType?: {
    code: string;
    codeName: string;
  };
  baseBlockStorageSize: number;
  memorySize: number;
  cpuCount: number;
}

export interface ServerListResponse {
  getServerInstanceListResponse: {
    requestId: string;
    returnCode: string;
    returnMessage: string;
    totalRows: number;
    serverInstanceList: ServerInstance[];
  };
}

export interface ServerResult {
  success: boolean;
  count: number;
  servers: ServerInstance[];
  error?: string;
}

export class NcpServerService extends NcpApiClient {
  constructor(credentials: NcpCredentials) {
    super(credentials);
  }

  /**
   * VPC 서버 목록 조회
   */
  async getVpcServers(): Promise<ServerResult> {
    const uri = '/vserver/v2/getServerInstanceList?responseFormatType=json';
    const response = await this.request<ServerListResponse>(VPC_SERVER_API_URL, 'GET', uri);

    if (!response.success || !response.data) {
      return {
        success: false,
        count: 0,
        servers: [],
        error: response.error
      };
    }

    const serverList = response.data.getServerInstanceListResponse?.serverInstanceList || [];

    return {
      success: true,
      count: serverList.length,
      servers: serverList
    };
  }

  /**
   * VPC 서버 정지
   */
  async stopServer(serverInstanceNo: string): Promise<NcpApiResponse<unknown>> {
    const uri = `/vserver/v2/stopServerInstances?serverInstanceNoList.1=${serverInstanceNo}&responseFormatType=json`;
    return this.request(VPC_SERVER_API_URL, 'GET', uri);
  }

  /**
   * 서버 반납 보호 설정 변경
   */
  async changeServerProtection(serverInstanceNo: string, isProtected: boolean): Promise<NcpApiResponse<unknown>> {
    const uri = `/vserver/v2/changeServerInstanceProtection?serverInstanceNo=${serverInstanceNo}&isProtection=${isProtected}&responseFormatType=json`;
    return this.request(VPC_SERVER_API_URL, 'GET', uri);
  }

  /**
   * VPC 서버 반납 (삭제)
   */
  async terminateServer(serverInstanceNo: string): Promise<NcpApiResponse<unknown>> {
    const uri = `/vserver/v2/terminateServerInstances?serverInstanceNoList.1=${serverInstanceNo}&responseFormatType=json`;
    return this.request(VPC_SERVER_API_URL, 'GET', uri);
  }

  /**
   * 블록 스토리지 목록 조회
   */
  async getBlockStorageList(serverInstanceNo?: string): Promise<{
    success: boolean;
    blockStorages: Array<{
      blockStorageInstanceNo: string;
      blockStorageName: string;
      blockStorageSize: number;
      serverInstanceNo?: string;
      blockStorageType: { code: string; codeName: string };
      deviceName?: string;
    }>;
    error?: string;
  }> {
    let uri = '/vserver/v2/getBlockStorageInstanceList?responseFormatType=json';
    if (serverInstanceNo) {
      uri += `&serverInstanceNo=${serverInstanceNo}`;
    }

    const response = await this.request<{
      getBlockStorageInstanceListResponse: {
        blockStorageInstanceList: Array<{
          blockStorageInstanceNo: string;
          blockStorageName: string;
          blockStorageSize: number;
          serverInstanceNo?: string;
          blockStorageType: { code: string; codeName: string };
          deviceName?: string;
        }>;
      };
    }>(VPC_SERVER_API_URL, 'GET', uri);

    if (!response.success || !response.data) {
      return { success: false, blockStorages: [], error: response.error };
    }

    return {
      success: true,
      blockStorages: response.data.getBlockStorageInstanceListResponse?.blockStorageInstanceList || []
    };
  }

  /**
   * 블록 스토리지 분리
   */
  async detachBlockStorage(serverInstanceNo: string, blockStorageInstanceNoList: string[]): Promise<NcpApiResponse<unknown>> {
    let uri = `/vserver/v2/detachBlockStorageInstances?serverInstanceNo=${serverInstanceNo}`;
    blockStorageInstanceNoList.forEach((no, idx) => {
      uri += `&blockStorageInstanceNoList.${idx + 1}=${no}`;
    });
    uri += '&responseFormatType=json';
    return this.request(VPC_SERVER_API_URL, 'GET', uri);
  }

  /**
   * 블록 스토리지 삭제
   */
  async deleteBlockStorage(blockStorageInstanceNoList: string[]): Promise<NcpApiResponse<unknown>> {
    let uri = '/vserver/v2/deleteBlockStorageInstances?';
    blockStorageInstanceNoList.forEach((no, idx) => {
      uri += `blockStorageInstanceNoList.${idx + 1}=${no}&`;
    });
    uri += 'responseFormatType=json';
    return this.request(VPC_SERVER_API_URL, 'GET', uri);
  }

  /**
   * 모든 서버 정지 후 반납
   */
  async terminateAllServers(): Promise<{
    success: boolean;
    terminated: string[];
    failed: Array<{ id: string; error: string }>;
  }> {
    const listResult = await this.getVpcServers();

    if (!listResult.success) {
      return {
        success: false,
        terminated: [],
        failed: [{ id: 'list', error: listResult.error || 'Failed to get servers' }]
      };
    }

    const terminated: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const server of listResult.servers) {
      // 실행 중인 서버는 먼저 정지
      if (server.serverInstanceStatus.code === 'RUN') {
        const stopResult = await this.stopServer(server.serverInstanceNo);
        if (!stopResult.success) {
          failed.push({
            id: server.serverInstanceNo,
            error: `Stop failed: ${stopResult.error}`
          });
          continue;
        }
        // 서버 정지 대기
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      // 서버 반납
      const terminateResult = await this.terminateServer(server.serverInstanceNo);
      if (terminateResult.success) {
        terminated.push(server.serverInstanceNo);
      } else {
        failed.push({
          id: server.serverInstanceNo,
          error: terminateResult.error || 'Unknown error'
        });
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return {
      success: failed.length === 0,
      terminated,
      failed
    };
  }

  /**
   * Public IP 목록 조회
   */
  async getPublicIpList(): Promise<{
    success: boolean;
    publicIps: Array<{
      publicIpInstanceNo: string;
      publicIp: string;
      publicIpDescription?: string;
      publicIpInstanceStatus: { code: string; codeName: string };
      serverInstanceAssociatedWithPublicIp?: {
        serverInstanceNo: string;
        serverName: string;
      };
      createDate: string;
    }>;
    error?: string;
  }> {
    const uri = '/vserver/v2/getPublicIpInstanceList?responseFormatType=json';

    const response = await this.request<{
      getPublicIpInstanceListResponse: {
        publicIpInstanceList: Array<{
          publicIpInstanceNo: string;
          publicIp: string;
          publicIpDescription?: string;
          publicIpInstanceStatus: { code: string; codeName: string };
          serverInstanceAssociatedWithPublicIp?: {
            serverInstanceNo: string;
            serverName: string;
          };
          createDate: string;
        }>;
      };
    }>(VPC_SERVER_API_URL, 'GET', uri);

    if (!response.success || !response.data) {
      return { success: false, publicIps: [], error: response.error };
    }

    return {
      success: true,
      publicIps: response.data.getPublicIpInstanceListResponse?.publicIpInstanceList || []
    };
  }

  /**
   * Public IP 삭제 (반납)
   */
  async deletePublicIp(publicIpInstanceNo: string): Promise<NcpApiResponse<unknown>> {
    const possibleEndpoints = [
      `/vserver/v2/releasePublicIpInstance?publicIpInstanceNo=${publicIpInstanceNo}`,
      `/vserver/v2/deletePublicIpInstance?publicIpInstanceNo=${publicIpInstanceNo}`,
      `/vserver/v2/deletePublicIpInstances?publicIpInstanceNoList.1=${publicIpInstanceNo}`,
      `/vpc/v2/releasePublicIp?publicIpInstanceNo=${publicIpInstanceNo}`,
      `/publicIp/v2/releasePublicIp?publicIpInstanceNo=${publicIpInstanceNo}`
    ];

    for (const endpoint of possibleEndpoints) {
      const uri = `${endpoint}&responseFormatType=json`;
      console.log(`[PUBLIC_IP] Trying delete endpoint: ${uri}`);
      const result = await this.request(VPC_SERVER_API_URL, 'GET', uri);

      if (result.success) {
        console.log(`[PUBLIC_IP] Delete success with endpoint: ${uri}`);
        return result;
      }

      console.log(`[PUBLIC_IP] Delete failed with endpoint: ${uri}, error: ${result.error}`);
    }

    return { success: false, error: 'All delete endpoints failed' };
  }

  /**
   * Public IP를 서버에서 분리
   */
  async disassociatePublicIp(publicIpInstanceNo: string): Promise<NcpApiResponse<unknown>> {
    const possibleEndpoints = [
      `/vserver/v2/disassociatePublicIpFromServerInstance?publicIpInstanceNo=${publicIpInstanceNo}`,
      `/vserver/v2/disassociatePublicIp?publicIpInstanceNo=${publicIpInstanceNo}`,
      `/vpc/v2/disassociatePublicIp?publicIpInstanceNo=${publicIpInstanceNo}`
    ];

    for (const endpoint of possibleEndpoints) {
      const uri = `${endpoint}&responseFormatType=json`;
      console.log(`[PUBLIC_IP] Trying disassociate endpoint: ${uri}`);
      const result = await this.request(VPC_SERVER_API_URL, 'GET', uri);

      if (result.success) {
        console.log(`[PUBLIC_IP] Disassociate success with endpoint: ${uri}`);
        return result;
      }

      console.log(`[PUBLIC_IP] Disassociate failed with endpoint: ${uri}, error: ${result.error}`);
    }

    return { success: false, error: 'All disassociate endpoints failed' };
  }
}
