import axios from 'axios';
import type { ApiResponse, User, Course, NcpAccount, DashboardData, CleanupJob, MonthlyCostResult } from '../types';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request interceptor - 토큰 추가
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor - 에러 처리
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth APIs
export const authApi = {
  login: async (email: string, password: string) => {
    const { data } = await api.post<ApiResponse<{ user: User; token: string }>>('/auth/login', { email, password });
    return data;
  },
  me: async () => {
    const { data } = await api.get<ApiResponse<User>>('/auth/me');
    return data;
  },
  changePassword: async (currentPassword: string, newPassword: string) => {
    const { data } = await api.put<ApiResponse<void>>('/auth/password', { currentPassword, newPassword });
    return data;
  },
  listUsers: async () => {
    const { data } = await api.get<ApiResponse<User[]>>('/auth/users');
    return data;
  },
  updateUserRole: async (userId: string, role: string) => {
    const { data } = await api.put<ApiResponse<User>>(`/auth/users/${userId}/role`, { role });
    return data;
  },
  toggleUserActive: async (userId: string) => {
    const { data } = await api.put<ApiResponse<User>>(`/auth/users/${userId}/toggle-active`);
    return data;
  }
};

// Course APIs
export const courseApi = {
  list: async (params?: { status?: string; page?: number; limit?: number }) => {
    const { data } = await api.get<ApiResponse<Course[]>>('/courses', { params });
    return data;
  },
  get: async (id: string) => {
    const { data } = await api.get<ApiResponse<Course & { accounts: NcpAccount[] }>>(`/courses/${id}`);
    return data;
  },
  create: async (course: Partial<Course>) => {
    const { data } = await api.post<ApiResponse<Course>>('/courses', course);
    return data;
  },
  update: async (id: string, course: Partial<Course>) => {
    const { data } = await api.put<ApiResponse<Course>>(`/courses/${id}`, course);
    return data;
  },
  delete: async (id: string) => {
    const { data } = await api.delete<ApiResponse<void>>(`/courses/${id}`);
    return data;
  },
  syncAll: async (courseId: string) => {
    const { data } = await api.post<ApiResponse<{
      total: number;
      results: Array<{
        accountId: string;
        accountName: string;
        success: boolean;
        subAccountCount: number;
        resources: Record<string, number>;
        totalResourceCount: number;
        totalCost: number;
        totalUseAmount: number;
        error?: string;
      }>;
      summary: {
        totalSubAccounts: number;
        totalResources: number;
        totalCost: number;
        totalUseAmount: number;
        accountsWithResources: number;
        successCount: number;
        failCount: number;
      };
    }>>(`/courses/${courseId}/sync-all`);
    return data;
  },
  getCumulativeCosts: async (courseId: string) => {
    const { data } = await api.get<ApiResponse<{
      totalCost: number;
      periods: number;
      startMonth?: string;
      endMonth?: string;
      byAccount: Array<{ accountId: string; accountName: string; cost: number }>;
    }>>(`/courses/${courseId}/cumulative-costs`);
    return data;
  },
  cleanupResources: async (courseId: string, accountIds: string[], isDryRun: boolean = true) => {
    const { data } = await api.post<ApiResponse<{
      isDryRun: boolean;
      total: number;
      results: Array<{
        accountId: string;
        accountName: string;
        success: boolean;
        actions: Array<{
          type: string;
          targetId: string;
          targetName?: string;
          status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
          error?: string;
        }>;
        error?: string;
      }>;
      summary: {
        totalAccounts: number;
        totalActions: number;
        successActions: number;
        failedActions: number;
        skippedActions: number;
      };
    }>>(`/courses/${courseId}/cleanup-resources`, { accountIds, isDryRun });
    return data;
  }
};

// Account APIs
export const accountApi = {
  list: async (courseId: string) => {
    const { data } = await api.get<ApiResponse<NcpAccount[]>>(`/accounts/course/${courseId}`);
    return data;
  },
  get: async (id: string) => {
    const { data } = await api.get<ApiResponse<NcpAccount>>(`/accounts/${id}`);
    return data;
  },
  add: async (courseId: string, accessKey: string, secretKey: string, displayName?: string, isMaster?: boolean) => {
    const { data } = await api.post<ApiResponse<NcpAccount>>(`/accounts/course/${courseId}`, {
      accessKey,
      secretKey,
      displayName,
      isMaster
    });
    return data;
  },
  addBulk: async (courseId: string, accounts: Array<{ accessKey: string; secretKey: string; displayName?: string }>, startNumber?: number) => {
    const { data } = await api.post<ApiResponse<{ total: number; success: number; failed: number }>>(`/accounts/course/${courseId}/bulk`, {
      accounts,
      startNumber
    });
    return data;
  },
  bulkRename: async (courseId: string, prefix: string, startNumber: number) => {
    const { data } = await api.put<ApiResponse<{ renamed: number }>>(`/accounts/course/${courseId}/bulk-rename`, {
      prefix,
      startNumber
    });
    return data;
  },
  update: async (id: string, updates: Partial<NcpAccount & { accessKey?: string; secretKey?: string }>) => {
    const { data } = await api.put<ApiResponse<NcpAccount>>(`/accounts/${id}`, updates);
    return data;
  },
  delete: async (id: string) => {
    const { data } = await api.delete<ApiResponse<void>>(`/accounts/${id}`);
    return data;
  },
  getCosts: async (id: string, month?: string) => {
    const params = month ? { month } : {};
    const { data } = await api.get<ApiResponse<MonthlyCostResult>>(`/accounts/${id}/costs`, { params });
    return data;
  },
  syncResources: async (id: string) => {
    const { data } = await api.post<ApiResponse<unknown>>(`/accounts/${id}/sync`);
    return data;
  },
  getSubAccounts: async (id: string) => {
    const { data } = await api.get<ApiResponse<{ count: number; accounts: unknown[] }>>(`/accounts/${id}/sub-accounts`);
    return data;
  },
  deleteSubAccount: async (accountId: string, subAccountId: string) => {
    const { data } = await api.delete<ApiResponse<{ subAccountId: string }>>(`/accounts/${accountId}/sub-accounts/${subAccountId}`);
    return data;
  },
  resetSubAccountPassword: async (accountId: string, subAccountId: string, newPassword: string) => {
    const { data } = await api.post<ApiResponse<void>>(`/accounts/${accountId}/sub-accounts/${subAccountId}/reset-password`, { newPassword });
    return data;
  },
  setMaster: async (accountId: string) => {
    const { data } = await api.put<ApiResponse<NcpAccount>>(`/accounts/${accountId}/set-master`);
    return data;
  },
  unsetMaster: async (accountId: string) => {
    const { data } = await api.put<ApiResponse<NcpAccount>>(`/accounts/${accountId}/unset-master`);
    return data;
  },
  bulkSetMemberNumbers: async (courseId: string, assignments: Array<{ displayName: string; memberNo: string }>) => {
    const { data } = await api.post<ApiResponse<{
      total: number;
      updated: number;
      results: Array<{ displayName: string; memberNo: string; status: 'updated' | 'not_found' }>;
    }>>(`/accounts/course/${courseId}/member-numbers`, { assignments });
    return data;
  }
};

// Monitoring APIs
export const monitoringApi = {
  getDashboard: async () => {
    const { data } = await api.get<ApiResponse<DashboardData>>('/monitoring/dashboard');
    return data;
  },
  exportCostsCsv: (courseId: string) => {
    window.open(`/api/monitoring/courses/${courseId}/costs/export/csv`, '_blank');
  },
  exportAccountsCsv: (courseId: string, includeSubAccounts: boolean = false) => {
    const params = includeSubAccounts ? '?includeSubAccounts=true' : '';
    window.open(`/api/monitoring/courses/${courseId}/accounts/export/csv${params}`, '_blank');
  }
};

// Cleanup APIs
export const cleanupApi = {
  listJobs: async (courseId?: string) => {
    const { data } = await api.get<ApiResponse<CleanupJob[]>>('/cleanup/jobs', { params: { courseId } });
    return data;
  },
  getJob: async (jobId: string) => {
    const { data } = await api.get<ApiResponse<CleanupJob>>(`/cleanup/jobs/${jobId}`);
    return data;
  },
  preview: async (courseId: string) => {
    const { data } = await api.get<ApiResponse<unknown>>(`/cleanup/courses/${courseId}/preview`);
    return data;
  },
  createJob: async (courseId: string, isDryRun: boolean = true, scheduledAt?: string) => {
    const { data } = await api.post<ApiResponse<CleanupJob>>(`/cleanup/courses/${courseId}/jobs`, {
      isDryRun,
      scheduledAt
    });
    return data;
  },
  executeJob: async (jobId: string) => {
    const { data } = await api.post<ApiResponse<unknown>>(`/cleanup/jobs/${jobId}/execute`, {
      confirm: 'DELETE_ALL_RESOURCES'
    });
    return data;
  },
  cancelJob: async (jobId: string) => {
    const { data } = await api.post<ApiResponse<void>>(`/cleanup/jobs/${jobId}/cancel`);
    return data;
  }
};

export default api;
