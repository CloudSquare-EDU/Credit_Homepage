// CourseDetail shared types
export interface SyncResult {
  accountId: string;
  accountName: string;
  success: boolean;
  subAccountCount?: number;
  serviceCount?: number;
  services?: string[];
  error?: string;
}

export interface AccountResourceData {
  resources: Record<string, number>;
  totalResourceCount: number;
  totalCost: number;
  lastSynced: Date;
}

// User types
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER';
  isActive?: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

// Course types
export interface Course {
  id: string;
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  billingPeriod?: string;
  tags: string[];
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  budgetAmount?: number | null;  // 예산 (원, VAT 별도)
  budgetRatio?: number | null;   // 할당 비율 (%)
  createdAt: string;
  updatedAt: string;
  _count?: {
    accounts: number;
  };
  costSnapshots?: Array<{ totalCost: number; createdAt: string }>;
  totalCumulativeCost?: number | null;
  cumulativeCostUpdatedAt?: string | null;
}

// Account types
export interface NcpAccount {
  id: string;
  courseId: string;
  displayName?: string;
  accessKeyHash: string;
  accessKeyPreview?: string;
  isActive: boolean;
  isMaster?: boolean;
  ncpMemberNo?: string | null;
  lastSyncAt?: string;
  createdAt: string;
  _count?: {
    resources: number;
    subAccounts: number;
    usageRecords: number;
  };
  subAccounts?: SubAccount[];
}

// Resource types
export interface Resource {
  id: string;
  ncpAccountId: string;
  resourceType: string;
  resourceId: string;
  resourceName?: string;
  region?: string;
  status?: string;
  spec?: Record<string, unknown>;
}

// SubAccount types
export interface SubAccount {
  subAccountId: string;
  subAccountLoginId?: string;  // NCP API에서 반환
  subAccountName?: string;     // NCP API에서 반환
  name?: string;               // DB에서 반환되는 필드 (subAccountName || subAccountLoginId)
  email?: string;
  // 표시용 헬퍼 - 우선순위: subAccountName > subAccountLoginId > name > subAccountId
  displayName?: string;
}

// Service usage types
export interface ServiceUsage {
  serviceCode: string;
  serviceName: string;
  usageQuantity: number;
  usageUnit: string;
  cost: number;
}

// Monthly cost types
export interface ProductCost {
  productCode: string;
  productName: string;
  demandAmount: number;
  useAmount: number;
}

export interface MonthlyCostResult {
  success: boolean;
  costs: ProductCost[];
  totalDemandAmount: number;
  totalUseAmount: number;
  // 청구서 레벨 합계 (getDemandCostList)
  invoiceUseAmount?: number;        // 사용 요금 합계 (절사 전)
  invoiceDemandAmount?: number;     // 이용 요금 (절사 후, VAT 전)
  invoiceVatAmount?: number;        // 부가세
  invoiceTotalAmount?: number;      // 청구 요금 (VAT 포함)
  invoiceTruncationAmount?: number; // 절사 금액
  month: string;
  error?: string;
}

// Services with cost response
export interface ServicesWithCostResponse {
  success: boolean;
  services: string[];
  serviceDetails: ServiceUsage[];
  count: number;
  date: string;
  totalCost: number;
  monthlyCost: MonthlyCostResult | null;
}

// Cost snapshot types
export interface CostSnapshot {
  id: string;
  courseId: string;
  periodStart: string;
  periodEnd: string;
  totalCost: number;
  currency: string;
  accountCount: number;
  breakdown?: Record<string, number>;
  createdAt: string;
}

// Cleanup job types
export interface CleanupJob {
  id: string;
  courseId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  isDryRun: boolean;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  summary?: {
    totalAccounts: number;
    totalActions: number;
    successActions: number;
    failedActions: number;
  };
  course?: {
    id: string;
    name: string;
  };
}

// API response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Dashboard types
export interface DashboardData {
  summary: {
    totalCourses: number;
    activeCourses: number;
    totalActiveAccounts: number;
    coursesByStatus: Record<string, number>;
    totalCostAllCourses: number;
    costSnapshotCount: number;
  };
  alerts: {
    endingSoon: Array<{
      id: string;
      name: string;
      endDate: string;
    }>;
  };
  recentCostSnapshots: CostSnapshot[];
  recentActivity: Array<{
    id: string;
    action: string;
    entityType: string;
    createdAt: string;
    user?: {
      name: string;
      email: string;
    };
  }>;
}
