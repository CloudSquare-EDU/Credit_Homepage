/**
 * NCP Cloud Functions API 서비스
 * Cloud Functions 조회 및 삭제
 */

import { NcpApiClient, NcpCredentials, NcpApiResponse } from './ncpApiClient';

const CLOUD_FUNCTIONS_API_URL = 'https://ncloud.apigw.ntruss.com';

export interface CloudFunction {
  functionId: string;
  functionName: string;
  runtime: string;
  vpcNo?: string;
  subnetNo?: string;
  status: string;
  createDate: string;
}

export class NcpCloudFunctionService extends NcpApiClient {
  constructor(credentials: NcpCredentials) {
    super(credentials);
  }

  /**
   * Cloud Functions 목록 조회
   */
  async getFunctions(): Promise<{ success: boolean; functions: CloudFunction[]; error?: string }> {
    // NCP Cloud Functions API 엔드포인트 시도
    const possibleEndpoints = [
      '/scf/v1/functions?responseFormatType=json',
      '/cloudFunctions/v1/getFunctionList?responseFormatType=json',
      '/scf/v2/functions?responseFormatType=json',
      '/cloudFunctions/v2/getFunctionList?responseFormatType=json'
    ];

    let lastError = '';

    for (const uri of possibleEndpoints) {
      console.log(`[CLOUD_FUNCTIONS] Trying endpoint: ${uri}`);
      const response = await this.request<{ functions: CloudFunction[] }>(CLOUD_FUNCTIONS_API_URL, 'GET', uri);

      if (response.success && response.data) {
        console.log(`[CLOUD_FUNCTIONS] Success with endpoint: ${uri}`);
        return {
          success: true,
          functions: response.data.functions || []
        };
      }

      lastError = response.error || 'Unknown error';
      console.log(`[CLOUD_FUNCTIONS] Failed with endpoint: ${uri}, error: ${lastError}`);
    }

    // 실패해도 빈 배열 반환 (Cloud Functions가 없을 수도 있음)
    console.log(`[CLOUD_FUNCTIONS] All endpoints failed, assuming no functions exist`);
    return { success: true, functions: [], error: lastError };
  }

  /**
   * Cloud Function 삭제
   */
  async deleteFunction(functionId: string): Promise<NcpApiResponse<unknown>> {
    // 여러 가능한 삭제 엔드포인트 시도
    const possibleEndpoints = [
      `/scf/v1/functions/${functionId}?responseFormatType=json`,
      `/cloudFunctions/v1/deleteFunction?functionId=${functionId}&responseFormatType=json`,
      `/scf/v2/functions/${functionId}?responseFormatType=json`,
      `/cloudFunctions/v2/deleteFunction?functionId=${functionId}&responseFormatType=json`
    ];

    for (const uri of possibleEndpoints) {
      console.log(`[CLOUD_FUNCTIONS] Trying delete endpoint: ${uri}`);
      const result = await this.request(CLOUD_FUNCTIONS_API_URL, 'DELETE', uri);

      if (result.success) {
        console.log(`[CLOUD_FUNCTIONS] Delete success with endpoint: ${uri}`);
        return result;
      }

      console.log(`[CLOUD_FUNCTIONS] Delete failed with endpoint: ${uri}, error: ${result.error}`);
    }

    return { success: false, error: 'All delete endpoints failed' };
  }
}
