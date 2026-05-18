/**
 * NCP Storage API 서비스
 * Block Storage, NAS 등 스토리지 리소스 조회 및 삭제
 */

import { NcpApiClient, NcpCredentials, NcpApiResponse } from './ncpApiClient';

const STORAGE_API_URL = 'https://ncloud.apigw.ntruss.com';

export interface BlockStorageInstance {
  blockStorageInstanceNo: string;
  blockStorageName: string;
  blockStorageType: { code: string; codeName: string };
  blockStorageSize: number; // GB
  blockStorageInstanceStatus: { code: string; codeName: string };
  blockStorageDiskType: { code: string; codeName: string };
  serverInstanceNo?: string;
  deviceName?: string;
  maxIopsThroughput: number;
  isReturnProtection: boolean;
  zoneCode: string;
  regionCode: string;
  createDate: string;
}

export interface BlockStorageListResponse {
  getBlockStorageInstanceListResponse: {
    totalRows: number;
    blockStorageInstanceList: BlockStorageInstance[];
  };
}

export interface NasVolumeInstance {
  nasVolumeInstanceNo: string;
  nasVolumeInstanceStatus: { code: string; codeName: string };
  volumeName: string;
  volumeAllotmentProtocolType: { code: string; codeName: string };
  volumeTotalSize: number;
  volumeSize: number;
  volumeUseSize: number;
  volumeUseRatio: number;
  snapshotVolumeSize: number;
  isEncryptedVolume: boolean;
  zoneCode: string;
  regionCode: string;
  createDate: string;
}

export interface NasVolumeListResponse {
  getNasVolumeInstanceListResponse: {
    totalRows: number;
    nasVolumeInstanceList: NasVolumeInstance[];
  };
}

export class NcpStorageService extends NcpApiClient {
  constructor(credentials: NcpCredentials) {
    super(credentials);
  }

  /**
   * Block Storage 목록 조회
   */
  async getBlockStorageList(): Promise<{
    success: boolean;
    storages: BlockStorageInstance[];
    error?: string;
  }> {
    const uri = '/vserver/v2/getBlockStorageInstanceList?responseFormatType=json';
    const response = await this.request<BlockStorageListResponse>(STORAGE_API_URL, 'GET', uri);

    if (!response.success || !response.data) {
      return { success: false, storages: [], error: response.error };
    }

    return {
      success: true,
      storages: response.data.getBlockStorageInstanceListResponse?.blockStorageInstanceList || []
    };
  }

  /**
   * NAS Volume 목록 조회
   */
  async getNasVolumeList(): Promise<{
    success: boolean;
    volumes: NasVolumeInstance[];
    error?: string;
  }> {
    const uri = '/vnas/v2/getNasVolumeInstanceList?responseFormatType=json';
    const response = await this.request<NasVolumeListResponse>(STORAGE_API_URL, 'GET', uri);

    if (!response.success || !response.data) {
      return { success: false, volumes: [], error: response.error };
    }

    return {
      success: true,
      volumes: response.data.getNasVolumeInstanceListResponse?.nasVolumeInstanceList || []
    };
  }

  /**
   * Block Storage 삭제
   */
  async deleteBlockStorage(blockStorageInstanceNo: string): Promise<NcpApiResponse<unknown>> {
    const uri = `/vserver/v2/deleteBlockStorageInstances?blockStorageInstanceNoList.1=${blockStorageInstanceNo}&responseFormatType=json`;
    return this.request(STORAGE_API_URL, 'GET', uri);
  }

  /**
   * NAS Volume 삭제
   */
  async deleteNasVolume(nasVolumeInstanceNo: string): Promise<NcpApiResponse<unknown>> {
    const uri = `/vnas/v2/deleteNasVolumeInstance?nasVolumeInstanceNo=${nasVolumeInstanceNo}&responseFormatType=json`;
    return this.request(STORAGE_API_URL, 'GET', uri);
  }
}
