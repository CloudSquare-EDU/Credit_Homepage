import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronRightIcon, TrashIcon, CalendarDaysIcon, KeyIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { accountApi } from '../services/api';
import type { NcpAccount, SubAccount, MonthlyCostResult } from '../types';
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/Modal';
import { useAuth } from '../hooks/useAuth';
import { formatDate, formatCostExact } from '../utils/format';

// 최근 12개월 옵션 생성
const generateMonthOptions = () => {
  const options: { value: string; label: string }[] = [];
  const now = new Date();

  for (let i = 0; i < 12; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const value = `${year}${month}`;
    const label = `${year}년 ${month}월`;
    options.push({ value, label });
  }

  return options;
};

const monthOptions = generateMonthOptions();

// localStorage 키 생성
const getStorageKey = (accountId: string) => `account_${accountId}_data`;

// 저장된 데이터 타입
interface StoredAccountData {
  subAccounts: SubAccount[];
  resources: Record<string, number>;
  monthlyCost: MonthlyCostResult | null;
  totalCost: number;
  totalUseAmount: number;
  lastSynced: string;
}

export default function AccountDetailPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const [account, setAccount] = useState<NcpAccount | null>(null);
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [resources, setResources] = useState<Record<string, number>>({});
  const [monthlyCost, setMonthlyCost] = useState<MonthlyCostResult | null>(null);
  const [totalCost, setTotalCost] = useState<number>(0);
  const [totalUseAmount, setTotalUseAmount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isFetchingCost, setIsFetchingCost] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>(monthOptions[0].value);
  const [deletingSubAccount, setDeletingSubAccount] = useState<SubAccount | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [resetPasswordTarget, setResetPasswordTarget] = useState<SubAccount | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  const { user } = useAuth();
  const canDelete = user?.role === 'SUPER_ADMIN';
  const canEdit = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  // 데이터를 localStorage에 저장
  const saveToStorage = useCallback((data: StoredAccountData) => {
    if (accountId) {
      try {
        localStorage.setItem(getStorageKey(accountId), JSON.stringify(data));
      } catch (e) {
        console.error('Failed to save to localStorage:', e);
      }
    }
  }, [accountId]);

  // localStorage에서 데이터 불러오기
  const loadFromStorage = useCallback((): StoredAccountData | null => {
    if (accountId) {
      try {
        const saved = localStorage.getItem(getStorageKey(accountId));
        if (saved) {
          return JSON.parse(saved);
        }
      } catch (e) {
        console.error('Failed to load from localStorage:', e);
      }
    }
    return null;
  }, [accountId]);

  useEffect(() => {
    if (accountId) {
      loadAccountAndSync();
    }
  }, [accountId]);

  // 계정 정보 로드 및 자동 동기화
  const loadAccountAndSync = async () => {
    if (!accountId) return;

    try {
      // 1. 먼저 localStorage에서 캐시된 데이터 불러오기 (빠른 표시)
      const cached = loadFromStorage();
      if (cached) {
        setSubAccounts(cached.subAccounts);
        setResources(cached.resources);
        setMonthlyCost(cached.monthlyCost);
        setTotalCost(cached.totalCost || 0);
        setTotalUseAmount(cached.totalUseAmount || 0);
      }

      // 2. 계정 기본 정보 로드
      const response = await accountApi.get(accountId);
      if (response.success && response.data) {
        setAccount(response.data);
        setIsLoading(false);

        // 3. 자동 동기화 시작
        setIsSyncing(true);

        const newSubAccounts: SubAccount[] = [];
        let newResources: Record<string, number> = {};
        let newMonthlyCost: MonthlyCostResult | null = null;
        let newTotalCost = 0;
        let newTotalUseAmount = 0;

        // 병렬로 모든 데이터 조회 (비용, 서브계정, 리소스)
        // 비용은 선택된 월(기본: 이번 달)로 조회
        const [costsRes, subAccRes, resourcesRes] = await Promise.allSettled([
          accountApi.getCosts(accountId, selectedMonth),
          accountApi.getSubAccounts(accountId),
          accountApi.syncResources(accountId)
        ]);

        // 비용 처리
        if (costsRes.status === 'fulfilled' && costsRes.value.success && costsRes.value.data) {
          const data = costsRes.value.data;
          console.log('[Cost Debug] API Response:', JSON.stringify(data, null, 2));
          newMonthlyCost = data;
          setMonthlyCost(data);
          newTotalCost = data.totalDemandAmount || 0;
          newTotalUseAmount = data.totalUseAmount || 0;
          setTotalCost(newTotalCost);
          setTotalUseAmount(newTotalUseAmount);
        }

        // 서브계정 처리
        if (subAccRes.status === 'fulfilled' && subAccRes.value.success && subAccRes.value.data) {
          const accounts = subAccRes.value.data.accounts as SubAccount[];
          const mapped = accounts.map((sub) => ({
            subAccountId: sub.subAccountId,
            subAccountLoginId: sub.subAccountLoginId,
            subAccountName: sub.subAccountName || sub.subAccountLoginId || sub.name || sub.subAccountId,
            name: sub.name,
            email: sub.email
          }));
          newSubAccounts.push(...mapped);
          setSubAccounts(mapped);
        }

        // 리소스 처리 (subAccounts 제외 - 서브계정은 별도로 표시됨)
        if (resourcesRes.status === 'fulfilled' && resourcesRes.value.success && resourcesRes.value.data) {
          const data = resourcesRes.value.data as Record<string, { count: number }>;
          newResources = {
            servers: data.servers?.count || 0,
            vpcs: data.vpcs?.count || 0,
            subnets: data.subnets?.count || 0,
            loadBalancers: data.loadBalancers?.count || 0,
            blockStorages: data.blockStorages?.count || 0,
            natGateways: data.natGateways?.count || 0,
            nasVolumes: data.nasVolumes?.count || 0,
            targetGroups: data.targetGroups?.count || 0
          };
          setResources(newResources);
        }

        // localStorage에 저장
        saveToStorage({
          subAccounts: newSubAccounts,
          resources: newResources,
          monthlyCost: newMonthlyCost,
          totalCost: newTotalCost,
          totalUseAmount: newTotalUseAmount,
          lastSynced: new Date().toISOString()
        });

        setIsSyncing(false);
      }
    } catch (error) {
      console.error('Failed to load account:', error);
      toast.error('계정 정보를 불러오는데 실패했습니다');
    } finally {
      setIsLoading(false);
      setIsSyncing(false);
    }
  };

  // 특정 월 비용 조회
  const fetchCostByMonth = async (month: string) => {
    if (!accountId) return;

    setIsFetchingCost(true);
    try {
      const response = await accountApi.getCosts(accountId, month);
      if (response.success && response.data) {
        const data = response.data;
        setMonthlyCost(data);
        setTotalCost(data.totalDemandAmount || 0);
        setTotalUseAmount(data.totalUseAmount || 0);
      }
    } catch (error) {
      console.error('Failed to fetch cost:', error);
      toast.error('비용 조회에 실패했습니다');
    } finally {
      setIsFetchingCost(false);
    }
  };

  // 월 변경 핸들러
  const handleMonthChange = (month: string) => {
    setSelectedMonth(month);
    fetchCostByMonth(month);
  };

  const handleDeleteSubAccount = async () => {
    if (!deletingSubAccount || !accountId) return;

    setIsDeleting(true);
    try {
      await accountApi.deleteSubAccount(accountId, deletingSubAccount.subAccountId);
      toast.success('서브계정이 삭제되었습니다');
      setSubAccounts(prev => prev.filter(s => s.subAccountId !== deletingSubAccount.subAccountId));
      setDeletingSubAccount(null);
    } catch (error) {
      toast.error('서브계정 삭제에 실패했습니다');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetPasswordTarget || !accountId) return;
    if (newPassword.length < 8) {
      toast.error('비밀번호는 8자 이상이어야 합니다');
      return;
    }

    setIsResettingPassword(true);
    try {
      await accountApi.resetSubAccountPassword(accountId, resetPasswordTarget.subAccountId, newPassword);
      toast.success('비밀번호가 초기화되었습니다');
      setResetPasswordTarget(null);
      setNewPassword('');
    } catch (error) {
      toast.error('비밀번호 초기화에 실패했습니다');
    } finally {
      setIsResettingPassword(false);
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!account) {
    return <div className="text-center text-gray-500">계정을 찾을 수 없습니다.</div>;
  }

  const courseInfo = (account as unknown as { course?: { id: string; name: string } }).course;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link to="/courses" className="hover:text-ncp-primary">과정 관리</Link>
            <ChevronRightIcon className="h-4 w-4" />
            {courseInfo && (
              <>
                <Link to={`/courses/${courseInfo.id}`} className="hover:text-ncp-primary">
                  {courseInfo.name}
                </Link>
                <ChevronRightIcon className="h-4 w-4" />
              </>
            )}
            <span>{account.displayName || '계정'}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            {account.displayName || '이름 없음'}
          </h1>
        </div>
        {isSyncing && (
          <div className="flex items-center text-sm text-gray-500">
            <svg className="animate-spin h-4 w-4 mr-2 text-ncp-primary" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            동기화 중...
          </div>
        )}
      </div>

      {/* Account Info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Access Key', value: account.accessKeyPreview || account.accessKeyHash?.substring(0, 12) + '...' || '-', mono: true },
          {
            label: '상태',
            custom: (
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium mt-1 ${
                account.isActive ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${account.isActive ? 'bg-blue-500' : 'bg-gray-400'}`} />
                {account.isActive ? '활성' : '비활성'}
              </span>
            ),
          },
          {
            label: '마지막 동기화',
            value: account.lastSyncAt ? formatDate(account.lastSyncAt) : '없음',
          },
          {
            label: '등록일',
            value: formatDate(account.createdAt),
          },
        ].map((item, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-card px-4 py-3">
            <p className="text-xs text-gray-400 mb-1">{item.label}</p>
            {item.custom ?? (
              <p className={`text-sm font-medium text-gray-900 ${item.mono ? 'font-mono' : ''}`}>
                {item.value}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Monthly Cost Summary */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            월별 비용
          </h2>
          <div className="flex items-center gap-2">
            <CalendarDaysIcon className="h-5 w-5 text-gray-400" />
            <select
              value={selectedMonth}
              onChange={(e) => handleMonthChange(e.target.value)}
              disabled={isFetchingCost || isSyncing}
              className="input text-sm w-auto"
            >
              {monthOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {isFetchingCost && (
              <svg className="animate-spin h-4 w-4 text-ncp-primary" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
          </div>
        </div>
        {totalCost > 0 || totalUseAmount > 0 || (monthlyCost?.costs && monthlyCost.costs.length > 0) ? (
          <div className="space-y-4">
            {/* 총 비용 표시 - 사용금액을 메인으로 */}
            <div className="bg-gradient-to-r from-ncp-primary to-blue-600 rounded-lg p-6 text-white">
              <p className="text-sm opacity-80 mb-1">총 사용 금액</p>
              <p className="text-3xl font-bold">{formatCostExact(totalUseAmount)}</p>
              {totalCost > 0 && totalCost !== totalUseAmount && (
                <p className="text-sm opacity-80 mt-2">
                  청구 금액: {formatCostExact(totalCost)}
                </p>
              )}
            </div>

            {/* 제품별 비용 상세 */}
            {monthlyCost?.costs && monthlyCost.costs.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <th className="table-header">제품</th>
                      <th className="table-header text-right">사용 금액</th>
                      <th className="table-header text-right">청구 금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyCost.costs.map((cost, idx) => (
                      <tr key={idx} className="table-row">
                        <td className="py-2.5 px-4 text-sm text-gray-700">{cost.productName}</td>
                        <td className="py-2.5 px-4 text-sm text-right text-gray-600">
                          {cost.useAmount != null ? formatCostExact(cost.useAmount) : '-'}
                        </td>
                        <td className="py-2.5 px-4 text-sm text-right font-semibold text-ncp-primary">
                          {cost.demandAmount != null ? formatCostExact(cost.demandAmount) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : isSyncing || isFetchingCost ? (
          <div className="flex items-center justify-center py-8 text-gray-500">
            <svg className="animate-spin h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            비용 조회 중...
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-500">
              {monthOptions.find(m => m.value === selectedMonth)?.label || selectedMonth} 비용 데이터가 없습니다.
            </p>
            <p className="text-sm text-gray-400 mt-1">NCP Billing API는 매일 오전 7시에 데이터가 반영됩니다.</p>
          </div>
        )}
      </div>

      {/* Resources - 현재 보유 중인 리소스 (실시간) */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          현재 보유 리소스
          <span className="text-sm font-normal text-gray-500 ml-2">(리소스가 있으면 서비스 이용 중)</span>
        </h2>
        {Object.keys(resources).length > 0 ? (
          <>
            {Object.values(resources).some(count => count > 0) ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-red-700 font-medium">⚠️ 리소스가 남아있습니다. 비용이 발생할 수 있습니다.</p>
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <p className="text-green-700 font-medium">✓ 모든 리소스가 정리되었습니다.</p>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {Object.entries(resources).map(([type, count]) => (
                <div key={type} className={`rounded-lg p-4 text-center ${count > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                  <p className={`text-2xl font-bold ${count > 0 ? 'text-red-600' : 'text-gray-400'}`}>{count}</p>
                  <p className="text-sm text-gray-500 capitalize">{type}</p>
                </div>
              ))}
            </div>
          </>
        ) : isSyncing ? (
          <div className="flex items-center justify-center py-4 text-gray-500">
            <svg className="animate-spin h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            리소스 조회 중...
          </div>
        ) : (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-green-700 font-medium">✓ 보유 중인 리소스가 없습니다.</p>
          </div>
        )}
      </div>

      {/* Sub Accounts */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          서브계정 ({subAccounts.length})
        </h2>
        {subAccounts.length > 0 ? (
          <div className="space-y-2">
            {subAccounts.map((sub) => (
              <div
                key={sub.subAccountId}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg group"
              >
                <div>
                  <p className="font-medium">{sub.subAccountName || sub.subAccountLoginId}</p>
                  <p className="text-sm text-gray-500">{sub.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 font-mono">{sub.subAccountId}</span>
                  {canEdit && (
                    <button
                      onClick={() => { setResetPasswordTarget(sub); setNewPassword(''); }}
                      className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      title="비밀번호 초기화"
                    >
                      <KeyIcon className="h-4 w-4" />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => setDeletingSubAccount(sub)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      title="삭제"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : isSyncing ? (
          <div className="flex items-center justify-center py-4 text-gray-500">
            <svg className="animate-spin h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            서브계정 조회 중...
          </div>
        ) : (
          <p className="text-gray-500 text-center py-4">서브계정이 없습니다.</p>
        )}
      </div>

      {/* Delete Sub Account Modal */}
      {deletingSubAccount && (
        <Modal
          isOpen={!!deletingSubAccount}
          onClose={() => setDeletingSubAccount(null)}
          title="서브계정 삭제"
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-gray-600">
              <strong>"{deletingSubAccount.subAccountName || deletingSubAccount.subAccountLoginId}"</strong> 서브계정을 삭제하시겠습니까?
            </p>
            <p className="text-amber-600 text-sm">
              ⚠️ 이 작업은 NCP에서 서브계정을 완전히 삭제합니다. 되돌릴 수 없습니다.
            </p>
            <div className="flex justify-end gap-3">
              <button
                className="btn-secondary"
                onClick={() => setDeletingSubAccount(null)}
              >
                취소
              </button>
              <button
                className="btn-danger"
                onClick={handleDeleteSubAccount}
                disabled={isDeleting}
              >
                {isDeleting ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reset Password Modal */}
      {resetPasswordTarget && (
        <Modal
          isOpen={!!resetPasswordTarget}
          onClose={() => { setResetPasswordTarget(null); setNewPassword(''); }}
          title="서브계정 비밀번호 초기화"
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-gray-600 text-sm">
              <strong>{resetPasswordTarget.subAccountName || resetPasswordTarget.subAccountLoginId}</strong> 서브계정의 새 비밀번호를 설정합니다.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">새 비밀번호</label>
              <input
                type="password"
                className="input w-full"
                placeholder="8자 이상 입력"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleResetPassword(); }}
                autoFocus
              />
              <p className="text-xs text-gray-400 mt-1">NCP 비밀번호 정책: 영문 대/소문자, 숫자, 특수문자 포함 8자 이상</p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                className="btn-secondary"
                onClick={() => { setResetPasswordTarget(null); setNewPassword(''); }}
              >
                취소
              </button>
              <button
                className="btn-primary"
                onClick={handleResetPassword}
                disabled={isResettingPassword || newPassword.length < 8}
              >
                {isResettingPassword ? '처리 중...' : '비밀번호 초기화'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
