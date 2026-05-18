/**
 * NCP Sub Account API 서비스
 * 서브계정 조회 및 삭제
 */

import { NcpApiClient, NcpCredentials, NcpApiResponse } from './ncpApiClient';

const SUBACCOUNT_API_URL = 'https://subaccount.apigw.ntruss.com';

export interface SubAccountItem {
  subAccountId: string;
  subAccountLoginId: string;
  subAccountName?: string;
  email?: string;
  createTime?: string;
  updateTime?: string;
}

export interface SubAccountListResponse {
  items: SubAccountItem[];
  totalCount?: number;
}

export interface SubAccountResult {
  success: boolean;
  count: number;
  accounts: SubAccountItem[];
  error?: string;
}

export class NcpSubAccountService extends NcpApiClient {
  constructor(credentials: NcpCredentials) {
    super(credentials);
  }

  /**
   * 서브계정 목록 조회
   */
  async getSubAccounts(): Promise<SubAccountResult> {
    const uri = '/api/v1/sub-accounts';
    const response = await this.request<SubAccountListResponse>(SUBACCOUNT_API_URL, 'GET', uri);

    if (!response.success || !response.data) {
      return {
        success: false,
        count: 0,
        accounts: [],
        error: response.error
      };
    }

    const items = response.data.items || [];

    return {
      success: true,
      count: items.length,
      accounts: items
    };
  }

  /**
   * 서브계정 삭제
   */
  async deleteSubAccount(subAccountId: string): Promise<NcpApiResponse<void>> {
    const uri = `/api/v1/sub-accounts/${subAccountId}`;
    return this.request<void>(SUBACCOUNT_API_URL, 'DELETE', uri);
  }

  /**
   * 서브계정 비밀번호 초기화
   */
  async resetSubAccountPassword(subAccountId: string, newPassword: string): Promise<NcpApiResponse<void>> {
    const uri = `/api/v1/sub-accounts/${subAccountId}/password`;
    return this.request<void>(SUBACCOUNT_API_URL, 'POST', uri, { password: newPassword });
  }

  /**
   * 모든 서브계정 삭제 (일괄)
   */
  async deleteAllSubAccounts(): Promise<{
    success: boolean;
    deleted: string[];
    failed: Array<{ id: string; error: string }>;
  }> {
    const listResult = await this.getSubAccounts();

    if (!listResult.success) {
      return {
        success: false,
        deleted: [],
        failed: [{ id: 'list', error: listResult.error || 'Failed to get sub-accounts' }]
      };
    }

    const deleted: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const account of listResult.accounts) {
      const deleteResult = await this.deleteSubAccount(account.subAccountId);

      if (deleteResult.success) {
        deleted.push(account.subAccountId);
      } else {
        failed.push({
          id: account.subAccountId,
          error: deleteResult.error || 'Unknown error'
        });
      }

      // Rate limiting - 100ms 간격
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return {
      success: failed.length === 0,
      deleted,
      failed
    };
  }
}
