/**
 * NCP Snapshot & Backup API 서비스
 * Block Storage Snapshot 및 Server Backup 조회 및 삭제
 */

import { NcpApiClient, NcpCredentials, NcpApiResponse } from './ncpApiClient';

const VPC_SERVER_API_URL = 'https://ncloud.apigw.ntruss.com';

export interface Snapshot {
  blockStorageSnapshotInstanceNo: string;
  blockStorageSnapshotName: string;
  blockStorageSnapshotVolumeSize: number;
  originalBlockStorageInstanceNo: string;
  originalBlockStorageName: string;
  blockStorageSnapshotInstanceStatus: { code: string; codeName: string };
  blockStorageSnapshotInstanceOperation: { code: string; codeName: string };
  blockStorageSnapshotInstanceStatusName: string;
  createDate: string;
  blockStorageSnapshotDescription?: string;  // "auto created by server image - name (imageNo)"
  serverImageInstanceNo?: string;  // Snapshot이 사용되는 Server Image
  serverImageName?: string;
  hypervisorType?: string;
}

export interface ServerBackup {
  serverImageInstanceNo?: string;  // Classic API
  serverImageNo?: number | string;  // VPC API - 실제 필드
  serverImageName: string;
  serverImageDescription?: string;
  serverImageStatus?: { code: string; codeName: string };
  serverImageOperation?: { code: string; codeName: string };
  serverImagePlatformType?: { code: string; codeName: string };
  createDate?: string;
  createYmdt?: number;  // VPC API
  serverInstanceNo?: string;
  statusCode?: string;  // VPC API
  serverImageTypeCode?: string;  // SELF, etc
}

export class NcpSnapshotService extends NcpApiClient {
  constructor(credentials: NcpCredentials) {
    super(credentials);
  }

  /**
   * Block Storage Snapshot 목록 조회
   */
  async getSnapshotList(): Promise<{
    success: boolean;
    snapshots: Snapshot[];
    error?: string;
  }> {
    const uri = '/vserver/v2/getBlockStorageSnapshotInstanceList?responseFormatType=json';

    const response = await this.request<{
      getBlockStorageSnapshotInstanceListResponse: {
        blockStorageSnapshotInstanceList: Snapshot[];
      };
    }>(VPC_SERVER_API_URL, 'GET', uri);

    if (!response.success || !response.data) {
      return { success: false, snapshots: [], error: response.error };
    }

    const snapshots = response.data.getBlockStorageSnapshotInstanceListResponse?.blockStorageSnapshotInstanceList || [];

    // 스냅샷 상세 정보 로깅 (Server Image 정보 확인용)
    if (snapshots.length > 0) {
      console.log(`[SNAPSHOT_DEBUG] First snapshot full data:`, JSON.stringify(snapshots[0], null, 2));
    }

    return {
      success: true,
      snapshots
    };
  }

  /**
   * Block Storage Snapshot 삭제
   */
  async deleteSnapshot(snapshotInstanceNo: string): Promise<NcpApiResponse<unknown>> {
    const uri = `/vserver/v2/deleteBlockStorageSnapshotInstances?blockStorageSnapshotInstanceNoList.1=${snapshotInstanceNo}&responseFormatType=json`;
    return this.request(VPC_SERVER_API_URL, 'GET', uri);
  }

  /**
   * Snapshot 상세 정보 조회
   */
  async getSnapshotDetail(snapshotInstanceNo: string): Promise<NcpApiResponse<any>> {
    const uri = `/vserver/v2/getBlockStorageSnapshotInstanceDetail?blockStorageSnapshotInstanceNo=${snapshotInstanceNo}&responseFormatType=json`;
    return this.request(VPC_SERVER_API_URL, 'GET', uri);
  }

  /**
   * Snapshot에서 사용 중인 Server Image 찾기 및 삭제
   */
  async findAndDeleteServerImagesUsingSnapshots(): Promise<{
    success: boolean;
    deletedImages: number;
    errors: string[];
  }> {
    const snapshotsResult = await this.getSnapshotList();
    if (!snapshotsResult.success || snapshotsResult.snapshots.length === 0) {
      return { success: true, deletedImages: 0, errors: [] };
    }

    console.log(`[SNAPSHOT_CLEANUP] Found ${snapshotsResult.snapshots.length} snapshots`);

    let deletedImagesCount = 0;
    const errors: string[] = [];
    const serverImageIds = new Set<string>();

    // 각 스냅샷에서 Server Image 정보 추출
    for (const snapshot of snapshotsResult.snapshots) {
      console.log(`[SNAPSHOT_CLEANUP] Checking snapshot: ${snapshot.blockStorageSnapshotName}`);

      // 1. description 필드에서 Server Image ID 추출
      // 형식: "auto created by server image - kor-was (121782165)"
      if (snapshot.blockStorageSnapshotDescription) {
        const match = snapshot.blockStorageSnapshotDescription.match(/\((\d+)\)/);
        if (match && match[1]) {
          const imageId = match[1];
          console.log(`[SNAPSHOT_CLEANUP] Found server image ID from description: ${imageId}`);
          serverImageIds.add(imageId);
        }
      }

      // 2. 스냅샷 객체에 직접 serverImageInstanceNo가 있는지 확인
      if (snapshot.serverImageInstanceNo) {
        console.log(`[SNAPSHOT_CLEANUP] Found serverImageInstanceNo in snapshot: ${snapshot.serverImageInstanceNo}`);
        serverImageIds.add(snapshot.serverImageInstanceNo);
      }
    }

    // 찾은 Server Image들 삭제 시도
    console.log(`[SNAPSHOT_CLEANUP] Found ${serverImageIds.size} unique server images to delete`);
    for (const imageId of serverImageIds) {
      console.log(`[SNAPSHOT_CLEANUP] Attempting to delete server image: ${imageId}`);
      const result = await this.deleteServerImage(imageId);
      if (result.success) {
        deletedImagesCount++;
        console.log(`[SNAPSHOT_CLEANUP] ✓ Deleted server image: ${imageId}`);
      } else {
        console.log(`[SNAPSHOT_CLEANUP] ✗ Failed to delete server image ${imageId}: ${result.error}`);
        errors.push(`Failed to delete server image ${imageId}: ${result.error}`);
      }
    }

    return {
      success: errors.length === 0,
      deletedImages: deletedImagesCount,
      errors
    };
  }

  /**
   * Server Image (Backup) 목록 조회
   */
  async getServerImageList(): Promise<{
    success: boolean;
    serverImages: ServerBackup[];
    error?: string;
  }> {
    // 1. POST 요청으로 시도 (콘솔에서 사용하는 방식)
    const postEndpoints = [
      { uri: '/vpc-compute/v1/server-images', body: { filter: [{ field: 'serverImageTypeCodeList', json: ['SELF'] }] } },
      { uri: '/vpc-servers/v1/server-images', body: { filter: [{ field: 'serverImageTypeCodeList', json: ['SELF'] }] } },
      { uri: '/vserver/v2/getServerImageInstanceList', body: { filter: [{ field: 'serverImageTypeCodeList', json: ['SELF'] }] } },
      { uri: '/vserver/v2/server-images', body: { filter: [{ field: 'serverImageTypeCodeList', json: ['SELF'] }] } },
    ];

    for (const { uri, body } of postEndpoints) {
      console.log(`[SERVER_IMAGE] Trying POST endpoint: ${uri}`);
      const response = await this.request<{
        content?: ServerBackup[];
        total?: number;
        getServerImageInstanceListResponse?: { serverImageInstanceList: ServerBackup[] };
      }>(VPC_SERVER_API_URL, 'POST', uri, body);

      if (response.success && response.data) {
        console.log(`[SERVER_IMAGE] POST Response data keys:`, Object.keys(response.data));

        const serverImages = response.data.content ||
                           response.data.getServerImageInstanceListResponse?.serverImageInstanceList ||
                           [];

        if (serverImages.length > 0) {
          console.log(`[SERVER_IMAGE] Success with POST endpoint: ${uri}, found ${serverImages.length} images`);
          return { success: true, serverImages };
        }
      }
      console.log(`[SERVER_IMAGE] POST Failed with endpoint: ${uri}, error: ${response.error}`);
    }

    // 2. GET 요청으로 시도 (기존 방식)
    const possibleEndpoints = [
      // VPC Server Image API - regionCode와 함께
      '/vserver/v2/getServerImageInstanceList?regionCode=KR&serverImageTypeCodeList.1=SELF&responseFormatType=json',
      '/vserver/v2/getServerImageInstanceList?regionCode=KR&responseFormatType=json',
      // VPC Compute API 경로
      '/vpc-compute/v1/getServerImageList?responseFormatType=json',
      '/vpc-servers/v1/getServerImageList?responseFormatType=json',
      '/vpc-servers/v2/getServerImageList?responseFormatType=json',
      // 기존 엔드포인트들
      '/vserver/v2/getServerImageInstanceList?serverImageTypeCodeList.1=SELF&responseFormatType=json',
      '/vserver/v2/getServerImageInstanceList?serverImageTypeCode=SELF&responseFormatType=json',
      '/vserver/v2/getServerImageInstanceList?responseFormatType=json',
      '/vserver/v1/getServerImageInstanceList?serverImageTypeCodeList.1=SELF&responseFormatType=json',
      '/vserver/v2/getMemberServerImageInstanceList?regionCode=KR&responseFormatType=json',
      '/vserver/v2/getMemberServerImageInstanceList?responseFormatType=json',
      '/server/v2/getMemberServerImageList?regionCode=KR&responseFormatType=json',
      '/server/v2/getMemberServerImageList?responseFormatType=json',
      '/vserver/v3/getMemberServerImageList?responseFormatType=json',
      '/vserver/v2/getCustomImageList?responseFormatType=json',
      '/image/v2/getMemberImageList?responseFormatType=json',
      '/vserver/v2/getMemberServerImageList?responseFormatType=json',
      '/vserver/v2/getMyServerImageList?responseFormatType=json',
      '/vserver/v2/getServerImageProductList?responseFormatType=json'
    ];

    let lastError = '';

    for (const uri of possibleEndpoints) {
      console.log(`[SERVER_IMAGE] Trying GET endpoint: ${uri}`);
      const response = await this.request<{
        // 콘솔 API 응답 형식 (직접 content 배열)
        content?: ServerBackup[];
        total?: number;
        // NCP API 응답 형식들
        getServerImageInstanceListResponse?: { serverImageInstanceList: ServerBackup[]; totalRows?: number };
        getServerImageListResponse?: { serverImageList: ServerBackup[] };
        getMemberServerImageInstanceListResponse?: { memberServerImageInstanceList: ServerBackup[]; totalRows?: number };
        getResourceListResponse?: { resourceList: ServerBackup[] };
        getBackupListResponse?: { backupList: ServerBackup[] };
        getMemberServerImageListResponse?: { memberServerImageList: ServerBackup[] };
        getMyServerImageListResponse?: { myServerImageList: ServerBackup[] };
        getServerImageProductListResponse?: { serverImageProductList: ServerBackup[] };
        getCustomImageListResponse?: { customImageList: ServerBackup[] };
        getMemberImageListResponse?: { memberImageList: ServerBackup[] };
      }>(VPC_SERVER_API_URL, 'GET', uri);

      if (response.success && response.data) {
        // 디버깅: 실제 응답 구조 출력
        console.log(`[SERVER_IMAGE] GET Response data keys:`, Object.keys(response.data));

        const serverImages =
          response.data.content ||  // 콘솔 API 형식
          response.data.getServerImageInstanceListResponse?.serverImageInstanceList ||
          response.data.getServerImageListResponse?.serverImageList ||
          response.data.getMemberServerImageInstanceListResponse?.memberServerImageInstanceList ||
          response.data.getResourceListResponse?.resourceList ||
          response.data.getBackupListResponse?.backupList ||
          response.data.getMemberServerImageListResponse?.memberServerImageList ||
          response.data.getMyServerImageListResponse?.myServerImageList ||
          response.data.getServerImageProductListResponse?.serverImageProductList ||
          response.data.getCustomImageListResponse?.customImageList ||
          response.data.getMemberImageListResponse?.memberImageList || [];

        // totalRows가 있고 0이 아닌 경우에만 성공으로 간주
        const totalRows = response.data.getServerImageInstanceListResponse?.totalRows ||
                         response.data.getMemberServerImageInstanceListResponse?.totalRows ||
                         serverImages.length;

        console.log(`[SERVER_IMAGE] Endpoint ${uri}: found ${serverImages.length} images (totalRows: ${totalRows})`);

        if (serverImages.length > 0) {
          console.log(`[SERVER_IMAGE] Success with GET endpoint: ${uri}`);
          return { success: true, serverImages };
        }
      }

      lastError = response.error || 'Unknown error';
      console.log(`[SERVER_IMAGE] Failed with endpoint: ${uri}, error: ${lastError}`);
    }

    console.log(`[SERVER_IMAGE] All endpoints failed or returned 0 images`);
    return { success: true, serverImages: [], error: lastError };
  }

  /**
   * Server Image (Backup) 삭제
   */
  async deleteServerImage(serverImageInstanceNo: string): Promise<NcpApiResponse<unknown>> {
    // 1. DELETE/POST 메서드로 시도 (RESTful API 스타일)
    const restfulEndpoints = [
      { method: 'DELETE', uri: `/vpc-compute/v1/server-images/${serverImageInstanceNo}` },
      { method: 'DELETE', uri: `/vpc-servers/v1/server-images/${serverImageInstanceNo}` },
      { method: 'DELETE', uri: `/vserver/v2/server-images/${serverImageInstanceNo}` },
      { method: 'POST', uri: `/vpc-compute/v1/server-images/${serverImageInstanceNo}/delete` },
      { method: 'POST', uri: `/vpc-servers/v1/server-images/${serverImageInstanceNo}/delete` },
    ];

    for (const { method, uri } of restfulEndpoints) {
      console.log(`[SERVER_IMAGE] Trying ${method} endpoint: ${uri}`);
      const result = await this.request(VPC_SERVER_API_URL, method, uri);

      if (result.success) {
        console.log(`[SERVER_IMAGE] Delete success with ${method} endpoint: ${uri}`);
        return result;
      }

      console.log(`[SERVER_IMAGE] Delete failed with ${method} endpoint: ${uri}, error: ${result.error}`);
    }

    // 2. GET 메서드로 시도 (NCP 전통적 방식)
    const possibleEndpoints = [
      // VPC Server Image Instance 삭제 - regionCode 포함
      `/vserver/v2/deleteServerImageInstances?regionCode=KR&serverImageInstanceNoList.1=${serverImageInstanceNo}&responseFormatType=json`,
      `/vserver/v2/deleteServerImageInstances?serverImageInstanceNoList.1=${serverImageInstanceNo}&responseFormatType=json`,
      `/vserver/v2/deleteServerImageInstances?regionCode=KR&serverImageNoList.1=${serverImageInstanceNo}&responseFormatType=json`,
      `/vserver/v2/deleteServerImageInstances?serverImageNoList.1=${serverImageInstanceNo}&responseFormatType=json`,
      `/vserver/v1/deleteServerImageInstances?serverImageInstanceNoList.1=${serverImageInstanceNo}&responseFormatType=json`,
      `/vserver/v2/deleteServerImageInstance?serverImageInstanceNo=${serverImageInstanceNo}&responseFormatType=json`,
      `/vserver/v2/deleteServerImageInstance?serverImageNo=${serverImageInstanceNo}&responseFormatType=json`,
      // VPC Compute 경로
      `/vpc-compute/v1/deleteServerImage?serverImageNo=${serverImageInstanceNo}&responseFormatType=json`,
      `/vpc-servers/v1/deleteServerImage?serverImageNo=${serverImageInstanceNo}&responseFormatType=json`,
      `/vpc-servers/v2/deleteServerImage?serverImageNo=${serverImageInstanceNo}&responseFormatType=json`,
      // VPC Server Image 삭제
      `/server/v2/deleteMemberServerImages?serverImageNoList.1=${serverImageInstanceNo}&responseFormatType=json`,
      `/vserver/v3/deleteMemberServerImages?serverImageNoList.1=${serverImageInstanceNo}&responseFormatType=json`,
      `/vserver/v2/deleteMemberServerImages?serverImageNoList.1=${serverImageInstanceNo}&responseFormatType=json`,
      `/vserver/v2/deleteMyServerImages?serverImageNoList.1=${serverImageInstanceNo}&responseFormatType=json`,
      `/vserver/v2/deleteServerImages?serverImageNoList.1=${serverImageInstanceNo}&responseFormatType=json`,
      `/vserver/v2/deleteMemberServerImage?serverImageNo=${serverImageInstanceNo}&responseFormatType=json`
    ];

    for (const uri of possibleEndpoints) {
      console.log(`[SERVER_IMAGE] Trying GET delete endpoint: ${uri}`);
      const result = await this.request(VPC_SERVER_API_URL, 'GET', uri);

      if (result.success) {
        console.log(`[SERVER_IMAGE] Delete success with GET endpoint: ${uri}`);
        return result;
      }

      console.log(`[SERVER_IMAGE] Delete failed with GET endpoint: ${uri}, error: ${result.error}`);
    }

    return { success: false, error: 'All delete endpoints failed' };
  }
}
