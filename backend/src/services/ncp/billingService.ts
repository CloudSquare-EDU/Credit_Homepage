/**
 * NCP Billing API 서비스
 * 사용량 및 비용 조회
 */

import { NcpApiClient, NcpCredentials, NcpApiResponse } from './ncpApiClient';

const BILLING_API_URL = 'https://billingapi.apigw.ntruss.com';

export interface UsageItem {
  contract: {
    contractNo: string;
    contractType: {
      code: string;
      codeName: string;
    };
  };
  usage: {
    usageQuantity: number;
    usageUnitCode: string;
    useAmount?: number;       // 사용 금액
    useAmt?: number;          // 사용 금액 (다른 필드명)
    demandAmount?: number;    // 청구 금액
    demandAmt?: number;       // 청구 금액 (다른 필드명)
  };
}

export interface DailyUsageResponse {
  getContractUsageListByDailyResponse: {
    requestId: string;
    returnCode: string;
    returnMessage: string;
    totalRows: number;
    contractUsageListByDaily: UsageItem[];
  };
}

export interface ServiceUsage {
  serviceCode: string;
  serviceName: string;
  usageQuantity: number;
  usageUnit: string;
  cost: number;
}

// 제품별 청구 비용 응답 인터페이스
export interface ProductDemandCostItem {
  productCode?: string;
  productName?: string;
  productItemKindCode?: string;
  productItemKindName?: string;
  productDemandType?: {  // 실제 NCP API 응답 필드
    code: string;
    codeName: string;
    regionCode?: string;
  };
  demandType?: {
    code: string;
    codeName: string;
  };
  demandAmount: number;  // 청구 금액
  useAmount: number;     // 사용 금액
  promiseDiscountAmount?: number;  // 약정 할인 금액
  promotionDiscountAmount?: number; // 프로모션 할인 금액
}

export interface ProductDemandCostResponse {
  getProductDemandCostListResponse: {
    requestId: string;
    returnCode: string;
    returnMessage: string;
    totalRows: number;
    productDemandCostList: ProductDemandCostItem[];
  };
}

// 청구서 레벨 합계 인터페이스 (getDemandCostList API)
export interface DemandCostItem {
  demandMonth?: string;
  memberNo?: string;
  useAmount?: number;                   // 사용 요금 합계 (절사 전)
  rounddownDiscountAmount?: number;     // 절사 금액
  thisMonthVatAmount?: number;          // 부가세
  thisMonthVatRatio?: number;           // 부가세율
  totalDemandAmount?: number;           // 청구 요금 (VAT 포함)
  thisMonthDemandAmount?: number;
  thisMonthAmountIncludingVat?: number;
  promiseDiscountAmount?: number;
  promotionDiscountAmount?: number;
  coinUseAmount?: number;
}

export interface DemandCostListResponse {
  getDemandCostListResponse: {
    requestId: string;
    returnCode: string;
    returnMessage: string;
    totalRows: number;
    demandCostList: DemandCostItem[];
  };
}

export interface MonthlyCostResult {
  success: boolean;
  costs: Array<{
    productCode: string;
    productName: string;
    demandAmount: number;
    useAmount: number;
  }>;
  totalDemandAmount: number;
  totalUseAmount: number;
  // 청구서 레벨 집계 (getDemandCostList에서 가져옴)
  invoiceUseAmount?: number;      // 사용 요금 합계 (절사 전)
  invoiceDemandAmount?: number;   // 이용 요금 (절사 후, VAT 전)
  invoiceVatAmount?: number;      // 부가세
  invoiceTotalAmount?: number;    // 청구 요금 (VAT 포함)
  invoiceTruncationAmount?: number; // 절사 금액
  month: string;
  error?: string;
}

export interface ActiveServicesResult {
  success: boolean;
  services: string[];
  serviceDetails: ServiceUsage[];
  count: number;
  date: string;
  error?: string;
}

export class NcpBillingService extends NcpApiClient {
  constructor(credentials: NcpCredentials) {
    super(credentials);
  }

  /**
   * 일별 사용량 조회
   */
  async getDailyUsage(startDate: string, endDate: string): Promise<NcpApiResponse<DailyUsageResponse>> {
    const uri = `/billing/v1/cost/getContractUsageListByDaily?useStartDay=${startDate}&useEndDay=${endDate}&responseFormatType=json`;
    return this.request<DailyUsageResponse>(BILLING_API_URL, 'GET', uri);
  }

  /**
   * 현재 사용 중인 서비스 목록 조회 (이번 달 1일 ~ 어제)
   * 월 1일인 경우 전월 데이터 조회
   */
  async getActiveServices(): Promise<ActiveServicesResult> {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    // 이번 달 1일
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let startDateStr: string;
    let endDateStr: string;

    // 월 1일인 경우: 전월 1일 ~ 전월 말일 조회
    if (now.getDate() === 1) {
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      startDateStr = prevMonth.toISOString().slice(0, 10).replace(/-/g, '');
      endDateStr = lastDayOfPrevMonth.toISOString().slice(0, 10).replace(/-/g, '');
    } else {
      // 일반 케이스: 이번 달 1일 ~ 어제
      startDateStr = firstDayOfMonth.toISOString().slice(0, 10).replace(/-/g, '');
      endDateStr = yesterday.toISOString().slice(0, 10).replace(/-/g, '');
    }

    console.log(`[Billing] Querying usage from ${startDateStr} to ${endDateStr}`);

    const response = await this.getDailyUsage(startDateStr, endDateStr);

    if (!response.success || !response.data) {
      return {
        success: false,
        services: [],
        serviceDetails: [],
        count: 0,
        date: yesterday.toISOString().slice(0, 10),
        error: response.error
      };
    }

    const usageList = response.data.getContractUsageListByDailyResponse?.contractUsageListByDaily || [];
    const serviceMap = new Map<string, ServiceUsage>();

    // 디버그: 첫 번째 아이템의 전체 구조 로깅
    if (usageList.length > 0) {
      console.log('[Billing Debug] First item structure:', JSON.stringify(usageList[0], null, 2));
    } else {
      console.log('[Billing Debug] No usage items returned');
    }

    for (const item of usageList) {
      const serviceName = item.contract?.contractType?.codeName || 'Unknown';
      const serviceCode = item.contract?.contractType?.code || 'unknown';
      const usageQty = item.usage?.usageQuantity || 0;
      // 여러 가능한 비용 필드 확인 (NCP API 버전에 따라 다를 수 있음)
      const usage = item.usage || {} as Record<string, unknown>;
      const cost = Number(usage.useAmount) || Number(usage.useAmt) ||
                   Number(usage.demandAmount) || Number(usage.demandAmt) || 0;
      const usageUnit = item.usage?.usageUnitCode || '';

      // 디버그: 비용이 0인 경우 usage 객체 로깅
      if (cost === 0 && usageQty > 0) {
        console.log('[Billing Debug] Cost is 0 but has usage. Full usage object:', JSON.stringify(usage));
      }

      if (usageQty > 0 || cost > 0) {
        const existing = serviceMap.get(serviceCode);
        if (existing) {
          existing.usageQuantity += usageQty;
          existing.cost += cost;
        } else {
          serviceMap.set(serviceCode, {
            serviceCode,
            serviceName,
            usageQuantity: usageQty,
            usageUnit,
            cost
          });
        }
      }
    }

    const serviceDetails = Array.from(serviceMap.values());
    const services = serviceDetails.map(s => s.serviceName).sort();

    return {
      success: true,
      services,
      serviceDetails,
      count: services.length,
      date: yesterday.toISOString().slice(0, 10)
    };
  }

  /**
   * 월별 비용 조회 (일별 사용량 기반)
   */
  async getMonthlyCost(yearMonth: string): Promise<NcpApiResponse<unknown>> {
    // yearMonth format: "202401"
    const startDay = yearMonth + '01';
    const year = parseInt(yearMonth.slice(0, 4));
    const month = parseInt(yearMonth.slice(4, 6));
    const lastDay = new Date(year, month, 0).getDate();
    const endDay = yearMonth + lastDay.toString().padStart(2, '0');

    return this.getDailyUsage(startDay, endDay);
  }

  /**
   * 청구서 레벨 합계 조회 (getDemandCostList API)
   * 절사 금액, 부가세, 청구 요금(VAT 포함) 포함
   */
  async getDemandCostList(startMonth: string, endMonth: string, isOrganization?: boolean, memberNoList?: string[]): Promise<NcpApiResponse<DemandCostListResponse>> {
    let uri = `/billing/v1/cost/getDemandCostList?startMonth=${startMonth}&endMonth=${endMonth}&responseFormatType=json`;
    if (isOrganization) uri += '&isOrganization=true';
    if (memberNoList && memberNoList.length > 0) {
      memberNoList.forEach(no => { uri += `&memberNoList=${no}`; });
    }
    return this.request<DemandCostListResponse>(BILLING_API_URL, 'GET', uri);
  }

  /**
   * 제품별 청구 비용 조회 (getProductDemandCostList API)
   * 실제 비용 데이터를 반환합니다.
   */
  async getProductDemandCost(startMonth: string, endMonth: string, isOrganization?: boolean, memberNoList?: string[]): Promise<NcpApiResponse<ProductDemandCostResponse>> {
    let uri = `/billing/v1/cost/getProductDemandCostList?startMonth=${startMonth}&endMonth=${endMonth}&responseFormatType=json`;
    if (isOrganization) uri += '&isOrganization=true';
    if (memberNoList && memberNoList.length > 0) {
      memberNoList.forEach(no => { uri += `&memberNoList=${no}`; });
    }
    return this.request<ProductDemandCostResponse>(BILLING_API_URL, 'GET', uri);
  }

  /**
   * 특정 월 비용 조회
   * @param yearMonth - YYYYMM 형식 (예: "202501")
   */
  async getMonthlyCostByMonth(yearMonth: string, isOrganization?: boolean): Promise<MonthlyCostResult> {
    // 입력 검증
    if (!/^\d{6}$/.test(yearMonth)) {
      return {
        success: false,
        costs: [],
        totalDemandAmount: 0,
        totalUseAmount: 0,
        month: yearMonth,
        error: 'Invalid month format. Use YYYYMM (e.g., 202501)'
      };
    }

    // 제품별 내역 + 청구서 레벨 합계를 병렬 조회
    // getDemandCostList는 isOrganization=true 없이 호출:
    //   - isOrganization=true 전달 시 멤버별 금액을 각 row로 반환 → 합산하면 2배가 됨
    //   - 마스터 계정(isOrganization=true)은 아래에서 invoiceResponse를 무시하고
    //     getProductDemandCost의 totalDemandAmount를 사용
    const [productResponse, invoiceResponse] = await Promise.allSettled([
      this.getProductDemandCost(yearMonth, yearMonth, isOrganization),
      this.getDemandCostList(yearMonth, yearMonth)
    ]);

    const response = productResponse.status === 'fulfilled' ? productResponse.value : null;

    if (!response?.success || !response.data) {
      return {
        success: false,
        costs: [],
        totalDemandAmount: 0,
        totalUseAmount: 0,
        month: yearMonth,
        error: response?.error
      };
    }

    const costList = response.data.getProductDemandCostListResponse?.productDemandCostList || [];

    // 제품별로 비용 집계
    const costMap = new Map<string, { productCode: string; productName: string; demandAmount: number; useAmount: number }>();

    for (const item of costList) {
      const productCode = item.productCode || item.productDemandType?.code || 'unknown';
      const productName = item.productName || item.productDemandType?.codeName || '알 수 없음';
      const key = productCode;
      const existing = costMap.get(key);

      if (existing) {
        existing.demandAmount += item.demandAmount || 0;
        existing.useAmount += item.useAmount || 0;
      } else {
        costMap.set(key, {
          productCode,
          productName,
          demandAmount: item.demandAmount || 0,
          useAmount: item.useAmount || 0
        });
      }
    }

    const costs = Array.from(costMap.values());
    const totalDemandAmount = costs.reduce((sum, c) => sum + c.demandAmount, 0);
    const totalUseAmount = costs.reduce((sum, c) => sum + c.useAmount, 0);

    // 청구서 레벨 합계 파싱
    let invoiceUseAmount: number | undefined;
    let invoiceDemandAmount: number | undefined;
    let invoiceVatAmount: number | undefined;
    let invoiceTotalAmount: number | undefined;
    let invoiceTruncationAmount: number | undefined;

    if (invoiceResponse.status === 'fulfilled' && invoiceResponse.value.success && invoiceResponse.value.data) {
      const invoiceList = invoiceResponse.value.data.getDemandCostListResponse?.demandCostList || [];

      if (!isOrganization) {
        // 일반 계정: getDemandCostList가 본인 청구 내역만 반환 → 정확한 invoice 금액 사용
        for (const inv of invoiceList) {
          const total = inv.totalDemandAmount ?? 0;
          const vat = inv.thisMonthVatAmount ?? 0;
          invoiceUseAmount = (invoiceUseAmount ?? 0) + (inv.useAmount ?? 0);
          invoiceTruncationAmount = (invoiceTruncationAmount ?? 0) + (inv.rounddownDiscountAmount ?? 0);
          invoiceVatAmount = (invoiceVatAmount ?? 0) + vat;
          invoiceTotalAmount = (invoiceTotalAmount ?? 0) + total;
          invoiceDemandAmount = (invoiceDemandAmount ?? 0) + (total - vat);
        }
      } else {
        // 마스터 계정(isOrganization=true):
        // - getDemandCostList(isOrg 없이)는 NCP 조직 구조에 따라 다르게 동작
        //   a) 통합 청구 조직(크레딧 있는 경우, 예: [가천대]):
        //      → 조직 전체 확정 청구서(크레딧 차감 후) 반환 → product total 대비 비율 높음(50%+)
        //   b) 멤버별 개별 청구 조직(예: [매치업]):
        //      → 마스터 본인 소액만 반환 → product total 대비 비율 매우 낮음(1%대)
        // - 현재 월은 청구서 미확정이므로 항상 product total(실시간 추정) 사용
        // - 이전 월에서 비율 >= 10%이면 통합 청구 조직으로 판단 → 크레딧 반영된 invoice 사용
        const now = new Date();
        const currentYM = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
        const isBillingCurrentMonth = yearMonth === currentYM;

        if (!isBillingCurrentMonth && invoiceList.length > 0) {
          let invDemandSum = 0, invVatSum = 0, invTotalSum = 0, invUseSum = 0, invTruncSum = 0;
          for (const inv of invoiceList) {
            const total = inv.totalDemandAmount ?? 0;
            const vat = inv.thisMonthVatAmount ?? 0;
            invUseSum += inv.useAmount ?? 0;
            invTruncSum += inv.rounddownDiscountAmount ?? 0;
            invVatSum += vat;
            invTotalSum += total;
            invDemandSum += total - vat;
          }
          // 비율 >= 10%: 통합 청구 조직 → 크레딧 반영된 정확한 금액 사용
          // 비율 < 10%: 마스터 본인 소액 → product total fallback 유지(invoiceDemandAmount undefined)
          if (totalDemandAmount > 0 && invDemandSum >= totalDemandAmount * 0.1) {
            invoiceUseAmount = invUseSum;
            invoiceTruncationAmount = invTruncSum;
            invoiceVatAmount = invVatSum;
            invoiceTotalAmount = invTotalSum;
            invoiceDemandAmount = invDemandSum;
          }
        }
        // 현재 월 또는 비율 낮은 경우: invoiceDemandAmount undefined → 프론트엔드에서 totalDemandAmount 사용
      }
    }

    return {
      success: true,
      costs,
      totalDemandAmount,
      totalUseAmount,
      invoiceUseAmount,
      invoiceDemandAmount,
      invoiceVatAmount,
      invoiceTotalAmount,
      invoiceTruncationAmount,
      month: yearMonth
    };
  }

  /**
   * YYYYMM 문자열에 월 수를 더한 결과 반환
   */
  private shiftMonth(yearMonth: string, delta: number): string {
    const year = parseInt(yearMonth.slice(0, 4));
    const month = parseInt(yearMonth.slice(4));
    const d = new Date(year, month - 1 + delta, 1);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * 과정 전체 기간 누적 비용 조회 (NCP API max 3개월/call 제한 대응)
   * @param startMonth - YYYYMM 형식 시작 월
   * @param endMonth   - YYYYMM 형식 종료 월
   */
  async getCumulativeCostByRange(startMonth: string, endMonth: string, isOrganization?: boolean, memberNoList?: string[]): Promise<{
    totalDemandAmount: number;
    totalUseAmount: number;
  }> {
    let totalDemandAmount = 0;
    let totalUseAmount = 0;
    let current = startMonth;

    while (current <= endMonth) {
      // NCP API는 한 번에 최대 3개월까지 조회 가능
      const batchEnd = this.shiftMonth(current, 2);
      const rangeEnd = batchEnd <= endMonth ? batchEnd : endMonth;

      const response = await this.getProductDemandCost(current, rangeEnd, isOrganization, memberNoList);
      if (response.success && response.data) {
        const costList = response.data.getProductDemandCostListResponse?.productDemandCostList || [];
        for (const item of costList) {
          totalDemandAmount += item.demandAmount || 0;
          totalUseAmount += item.useAmount || 0;
        }
      }

      current = this.shiftMonth(rangeEnd, 1);
    }

    return { totalDemandAmount, totalUseAmount };
  }

  /**
   * 청구서 레벨 누적 비용 조회 (getDemandCostList 기반)
   * 과금항목 할인 + 고객 할인 등 모든 할인이 반영된 실제 청구 금액
   * isOrganization 없이 호출해야 org 레벨 할인이 반영됨
   */
  async getCumulativeInvoiceCost(startMonth: string, endMonth: string, memberNoList?: string[]): Promise<{
    invoiceDemandAmount: number;  // 이용 요금 합계 (VAT 제외, 모든 할인 반영)
    invoiceTotalAmount: number;   // 청구 요금 합계 (VAT 포함)
  }> {
    let invoiceDemandAmount = 0;
    let invoiceTotalAmount = 0;
    let current = startMonth;

    const now = new Date();
    const currentYM = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 1개월씩 개별 쿼리
    while (current <= endMonth) {
      const isCurrentMonth = current === currentYM;

      // 현재 진행 중인 달은 getDemandCostList를 무시하고 getProductDemandCost 사용
      // (크레딧 중간 정산 등으로 totalDemandAmount=0인 row가 생성될 수 있어 실사용량 반영 안됨)
      if (!isCurrentMonth) {
        // 이전 달: getDemandCostList → 확정 청구서 (모든 할인 반영)
        const invoiceRes = await this.getDemandCostList(current, current, undefined, memberNoList);
        const invoiceList = invoiceRes.success ? (invoiceRes.data?.getDemandCostListResponse?.demandCostList ?? []) : [];

        if (invoiceList.length > 0) {
          for (const inv of invoiceList) {
            const total = inv.totalDemandAmount ?? 0;
            const vat = inv.thisMonthVatAmount ?? 0;
            invoiceTotalAmount += total;
            invoiceDemandAmount += total - vat;
          }
          current = this.shiftMonth(current, 1);
          continue;
        }
      }

      // 현재 달이거나 이전 달에 청구서 없음 → getProductDemandCost 사용 (실시간 추정)
      const hasMembers = memberNoList && memberNoList.length > 0;
      const productRes = await this.getProductDemandCost(
        current, current, true, hasMembers ? memberNoList : undefined
      );
      if (productRes.success && productRes.data) {
        const costList = productRes.data.getProductDemandCostListResponse?.productDemandCostList || [];
        for (const item of costList) {
          invoiceDemandAmount += item.demandAmount || 0;
          invoiceTotalAmount += item.demandAmount || 0;
        }
      }

      current = this.shiftMonth(current, 1);
    }

    return { invoiceDemandAmount, invoiceTotalAmount };
  }

  /**
   * 이번 달 비용 조회
   */
  async getCurrentMonthCost(isOrganization?: boolean): Promise<MonthlyCostResult> {
    const now = new Date();
    const yearMonth = now.toISOString().slice(0, 7).replace('-', ''); // "202501"
    return this.getMonthlyCostByMonth(yearMonth, isOrganization);
  }

  /**
   * 서비스 사용량과 비용을 함께 조회
   */
  async getActiveServicesWithCost(): Promise<ActiveServicesResult & { totalCost: number; monthlyCost: MonthlyCostResult | null }> {
    // 병렬로 사용량과 비용 조회
    const [usageResult, costResult] = await Promise.allSettled([
      this.getActiveServices(),
      this.getCurrentMonthCost()
    ]);

    const servicesData = usageResult.status === 'fulfilled' ? usageResult.value : {
      success: false,
      services: [],
      serviceDetails: [],
      count: 0,
      date: new Date().toISOString().slice(0, 10),
      error: 'Failed to get usage'
    };

    const costData = costResult.status === 'fulfilled' ? costResult.value : null;

    // 서비스별 비용 매핑 시도 (제품코드 기준)
    if (costData?.success && costData.costs.length > 0) {
      for (const service of servicesData.serviceDetails) {
        // 서비스 코드와 제품 코드 매칭 시도
        const matchingCost = costData.costs.find(c =>
          c.productCode === service.serviceCode ||
          c.productName === service.serviceName ||
          service.serviceName.includes(c.productName) ||
          c.productName.includes(service.serviceName)
        );

        if (matchingCost) {
          service.cost = matchingCost.demandAmount;
        }
      }
    }

    return {
      ...servicesData,
      totalCost: costData?.totalDemandAmount || 0,
      monthlyCost: costData
    };
  }
}
