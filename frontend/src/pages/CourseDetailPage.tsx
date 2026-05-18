import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  PlusIcon,
  ArrowPathIcon,
  ChevronRightIcon,
  DocumentArrowDownIcon,
  PencilIcon,
  KeyIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CheckIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  TrashIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { courseApi, accountApi, monitoringApi } from '../services/api';
import type { Course, NcpAccount, SyncResult, AccountResourceData } from '../types';
import LoadingSpinner from '../components/LoadingSpinner';
import StatusBadge from '../components/StatusBadge';
import { useAuth } from '../hooks/useAuth';
import { formatDateOnly, formatCostExact } from '../utils/format';
import AddAccountModal from '../components/modals/AddAccountModal';
import BulkAddAccountModal from '../components/modals/BulkAddAccountModal';
import EditApiKeyModal from '../components/modals/EditApiKeyModal';
import SyncResultModal from '../components/modals/SyncResultModal';
import BulkDeleteModal from '../components/modals/BulkDeleteModal';
import BulkCleanupModal from '../components/modals/BulkCleanupModal';
import BulkRenameModal from '../components/modals/BulkRenameModal';
import MemberNoModal from '../components/modals/MemberNoModal';


// 계정 이름에서 숫자 추출하여 정렬용으로 사용
const extractNumber = (name: string | null | undefined): number => {
  if (!name) return Infinity;
  const match = name.match(/(\d+)/);
  return match ? parseInt(match[1]) : Infinity;
};

export default function CourseDetailPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const [course, setCourse] = useState<Course | null>(null);
  const [accounts, setAccounts] = useState<NcpAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncResults, setSyncResults] = useState<SyncResult[]>([]);
  const [isSyncResultModalOpen, setIsSyncResultModalOpen] = useState(false);
  // localStorage에서 리소스 데이터 불러오기
  const [accountResourceMap, setAccountResourceMap] = useState<Record<string, AccountResourceData>>(() => {
    if (courseId) {
      try {
        const saved = localStorage.getItem(`course_${courseId}_resources`);
        if (saved) {
          const parsed = JSON.parse(saved);
          // Date 객체 복원
          Object.keys(parsed).forEach(key => {
            if (parsed[key].lastSynced) {
              parsed[key].lastSynced = new Date(parsed[key].lastSynced);
            }
          });
          return parsed;
        }
      } catch (e) {
        console.error('Failed to load resources from localStorage:', e);
      }
    }
    return {};
  });
  const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState(false);
  const [isBulkAddModalOpen, setIsBulkAddModalOpen] = useState(false);
  const [isBulkRenameModalOpen, setIsBulkRenameModalOpen] = useState(false);
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
  const [isBulkCleanupModalOpen, setIsBulkCleanupModalOpen] = useState(false);
  const [isMemberNoModalOpen, setIsMemberNoModalOpen] = useState(false);
  const [showAllAccounts, setShowAllAccounts] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localStorageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { user } = useAuth();

  // 년/월 선택 관련
  const [selectedYearMonth, setSelectedYearMonth] = useState<string>('');  // 빈 문자열 = 현재 월
  const [historicalCostMap, setHistoricalCostMap] = useState<Record<string, {
    totalCost: number;
    products: Array<{ productCode: string; productName: string; useAmount: number; demandAmount: number }>;
  }>>({});
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);

  // 전체 누적 사용료 (NCP billing API 직접 조회)
  const [cumulativeCosts, setCumulativeCosts] = useState<{
    totalCost: number;
    periods: number;
    startMonth?: string;
    endMonth?: string;
    byAccount: Array<{ accountId: string; accountName: string; cost: number }>;
  } | null>(null);
  const [isFetchingCumulative, setIsFetchingCumulative] = useState(false);

  // 현재 YYYYMM 반환
  const getCurrentYearMonth = () => {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  };

  // YYYYMM → "YYYY년 M월" 포맷 (안전하게 처리)
  const formatYearMonth = (ym: string) => {
    if (!ym || ym.length < 6) return '';
    return `${ym.slice(0, 4)}년 ${parseInt(ym.slice(4), 10)}월`;
  };

  // 최근 13개월 옵션 생성
  const monthOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const now = new Date();
    const currentYM = getCurrentYearMonth();
    for (let i = 0; i < 13; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
      const label = `${date.getFullYear()}년 ${date.getMonth() + 1}월${value === currentYM ? ' (현재)' : ''}`;
      options.push({ value, label });
    }
    return options;
  }, []);

  const canEdit = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const canDelete = user?.role === 'SUPER_ADMIN';

  // 검색 디바운스
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
  }, [searchQuery]);

  useEffect(() => {
    if (courseId) {
      loadCourse();
    }
  }, [courseId]);

  // 리소스 데이터 localStorage에 저장 (디바운스 500ms)
  useEffect(() => {
    if (!courseId || Object.keys(accountResourceMap).length === 0) return;
    if (localStorageTimerRef.current) clearTimeout(localStorageTimerRef.current);
    localStorageTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(`course_${courseId}_resources`, JSON.stringify(accountResourceMap));
      } catch (e) {
        console.error('Failed to save resources to localStorage:', e);
      }
    }, 500);
  }, [courseId, accountResourceMap]);

  const loadCourse = async () => {
    try {
      const response = await courseApi.get(courseId!);
      if (response.success && response.data) {
        setCourse(response.data);
        // 이름 순으로 정렬
        const sortedAccounts = [...(response.data.accounts || [])].sort((a, b) => {
          return extractNumber(a.displayName) - extractNumber(b.displayName);
        });
        setAccounts(sortedAccounts);
      }
    } catch (error) {
      console.error('Failed to load course:', error);
      toast.error('과정 정보를 불러오는데 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  // 전체 동기화 (백엔드 일괄 처리 - 가장 빠름)
  const handleSyncEverything = async () => {
    if (!accounts.length || !courseId) return;

    setIsSyncingAll(true);
    const startTime = Date.now();

    try {
      const response = await courseApi.syncAll(courseId);

      if (response.success && response.data) {
        const { results, summary } = response.data;

        // 리소스 맵 업데이트
        const newResourceMap: Record<string, AccountResourceData> = {};
        results.forEach(result => {
          newResourceMap[result.accountId] = {
            resources: result.resources,
            totalResourceCount: result.totalResourceCount,
            totalCost: result.totalCost || result.totalUseAmount,
            lastSynced: new Date()
          };
        });
        setAccountResourceMap(prev => ({ ...prev, ...newResourceMap }));

        // 결과 저장
        setSyncResults(results.map(r => ({
          accountId: r.accountId,
          accountName: r.accountName,
          success: r.success,
          subAccountCount: r.subAccountCount,
          error: r.error
        })));

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        if (summary.failCount === 0) {
          toast.success(
            `${summary.successCount}개 계정 동기화 완료 (${elapsed}초)\n` +
            `서브계정 ${summary.totalSubAccounts}개, 리소스 ${summary.totalResources}개, ` +
            `비용 ${formatCostExact(summary.totalUseAmount)}`
          );
        } else {
          toast.error(`${summary.successCount}개 성공, ${summary.failCount}개 실패`);
          setIsSyncResultModalOpen(true);
        }

        // 데이터 새로고침
        loadCourse();
      }
    } catch (error) {
      console.error('Sync failed:', error);
      toast.error('동기화에 실패했습니다');
    } finally {
      setIsSyncingAll(false);
    }
  };

  // 선택 월 비용 조회
  const handleFetchHistoricalCosts = useCallback(async (month?: string) => {
    if (!accounts.length) return;

    const targetMonth = month ?? selectedYearMonth ?? getCurrentYearMonth();
    setIsFetchingHistory(true);
    const newMap: typeof historicalCostMap = {};

    const masterAccount = accounts.find(a => a.isMaster);

    const BATCH_SIZE = 5;
    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
      const batch = accounts.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(async (account) => {
          try {
            const res = await accountApi.getCosts(account.id, targetMonth);
            if (res.success && res.data) {
              const data = res.data as { totalUseAmount?: number; totalDemandAmount?: number; invoiceDemandAmount?: number; costs?: Array<{ productCode: string; productName: string; useAmount: number; demandAmount: number }> };
              newMap[account.id] = {
                totalCost: data.invoiceDemandAmount ?? data.totalDemandAmount ?? data.totalUseAmount ?? 0,
                products: (data.costs || []).filter(p => (p.demandAmount || p.useAmount) > 0)
              };
            }
          } catch {
            // 개별 계정 오류 무시
          }
        })
      );
    }

    setHistoricalCostMap(newMap);
    setIsFetchingHistory(false);
    const y = targetMonth.slice(0, 4);
    const m = parseInt(targetMonth.slice(4));

    // 마스터 계정이 있으면 마스터 비용(조직 합계)이 이미 전체를 포함함을 안내
    if (masterAccount && newMap[masterAccount.id]?.totalCost > 0) {
      toast.success(`${y}년 ${m}월 비용 조회 완료 (마스터 계정 기준 조직 합계)`);
    } else {
      toast.success(`${y}년 ${m}월 비용 조회 완료`);
    }
  }, [accounts, selectedYearMonth]);

  // 전체 누적 사용료 조회 (스냅샷 기반)
  const handleFetchCumulativeCosts = useCallback(async () => {
    if (!courseId) return;
    setIsFetchingCumulative(true);
    try {
      const res = await courseApi.getCumulativeCosts(courseId);
      if (res.success && res.data) {
        setCumulativeCosts(res.data);
        toast.success(`전체 사용료 조회 완료 (${res.data.periods}개월)`);
      }
    } catch {
      toast.error('전체 사용료 조회에 실패했습니다');
    } finally {
      setIsFetchingCumulative(false);
    }
  }, [courseId]);


  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isManageMenuOpen, setIsManageMenuOpen] = useState(false);
  const [isDeleteMenuOpen, setIsDeleteMenuOpen] = useState(false);

  // CSV 필드 이스케이프 (쉼표/쌍따옴표/줄바꿈 처리)
  const escapeCSV = (value: string | number | null | undefined): string => {
    const str = String(value ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // 비용 리포트 CSV 내보내기 (클라이언트 사이드 생성)
  const handleExportCosts = async () => {
    if (!courseId || !accounts.length) return;
    setIsExportMenuOpen(false);

    const targetMonth = selectedYearMonth || getCurrentYearMonth();
    const y = targetMonth.slice(0, 4);
    const m = parseInt(targetMonth.slice(4));

    // 이미 조회된 데이터가 있으면 재사용, 없으면 새로 조회
    let costData = historicalCostMap;

    if (Object.keys(costData).length === 0) {
      const toastId = toast.loading(`${y}년 ${m}월 비용 데이터 조회 중...`);
      const newMap: typeof historicalCostMap = {};
      const BATCH_SIZE = 5;

      for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
        const batch = accounts.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
          batch.map(async (account) => {
            try {
              const res = await accountApi.getCosts(account.id, targetMonth);
              if (res.success && res.data) {
                const data = res.data as { totalUseAmount?: number; totalDemandAmount?: number; invoiceDemandAmount?: number; costs?: Array<{ productCode: string; productName: string; useAmount: number; demandAmount: number }> };
                newMap[account.id] = {
                  totalCost: data.invoiceDemandAmount ?? data.totalDemandAmount ?? data.totalUseAmount ?? 0,
                  products: (data.costs || []).filter(p => (p.demandAmount || p.useAmount) > 0)
                };
              }
            } catch { /* 개별 오류 무시 */ }
          })
        );
      }

      toast.dismiss(toastId);
      costData = newMap;
      // 조회 결과를 state에도 저장
      setHistoricalCostMap(newMap);
    }

    // CSV 행 생성
    const BOM = '\uFEFF';
    const lines: string[] = [];

    // 파일 제목 행
    lines.push(escapeCSV(`${y}년 ${m}월 비용 리포트 - ${course?.name || ''}`));
    lines.push('');

    // 헤더
    lines.push(['계정명', '서비스명', '사용금액(원)', '청구금액(원)'].map(escapeCSV).join(','));

    let grandTotal = 0;
    let accountCount = 0;

    for (const account of accounts) {
      const data = costData[account.id];
      if (!data) continue;

      const accountName = account.displayName || account.id;
      grandTotal += data.totalCost;

      if (data.products.length > 0) {
        for (const product of data.products) {
          lines.push([
            escapeCSV(accountName),
            escapeCSV(product.productName),
            product.useAmount.toString(),
            product.demandAmount.toString()
          ].join(','));
        }
        // 계정 소계 행
        lines.push([escapeCSV(accountName), escapeCSV('(소계)'), data.totalCost.toString(), ''].join(','));
      } else {
        lines.push([escapeCSV(accountName), escapeCSV('사용 없음'), '0', '0'].join(','));
      }

      accountCount++;
    }

    // 구분선 + 전체 합계
    lines.push('');
    lines.push([escapeCSV(`전체 합계 (${accountCount}개 계정)`), '', grandTotal.toString(), ''].join(','));

    const csv = BOM + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `비용리포트_${y}년${m}월_${course?.name || courseId}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success(`${y}년 ${m}월 비용 리포트 다운로드 완료`);
  };

  const handleExport = (type: 'costs' | 'accounts' | 'accounts_subaccounts') => {
    if (!courseId) return;
    setIsExportMenuOpen(false);

    switch (type) {
      case 'costs':
        handleExportCosts();
        break;
      case 'accounts':
        monitoringApi.exportAccountsCsv(courseId, false);
        break;
      case 'accounts_subaccounts':
        monitoringApi.exportAccountsCsv(courseId, true);
        break;
    }
  };

  // 검색 및 필터링 (useMemo로 최적화)
  const filteredAccounts = useMemo(() => {
    let result = accounts;

    // 서브계정이 없고 리소스도 없는 계정 필터링
    if (!showAllAccounts) {
      result = result.filter(acc => {
        const hasSubAccounts = (acc._count?.subAccounts || 0) > 0;
        const hasResources = accountResourceMap[acc.id]?.totalResourceCount > 0;
        return hasSubAccounts || hasResources;
      });
    }

    // 검색어 필터링
    if (debouncedSearchQuery.trim()) {
      const query = debouncedSearchQuery.toLowerCase().trim();
      result = result.filter(acc =>
        acc.displayName?.toLowerCase().includes(query) ||
        acc.accessKeyHash?.toLowerCase().includes(query)
      );
    }

    return result;
  }, [accounts, showAllAccounts, debouncedSearchQuery, accountResourceMap]);

  // 숨겨진 계정 수 (서브계정도 없고 리소스도 없는 계정)
  const hiddenCount = accounts.filter(acc => {
    const hasSubAccounts = (acc._count?.subAccounts || 0) > 0;
    const hasResources = accountResourceMap[acc.id]?.totalResourceCount > 0;
    return !hasSubAccounts && !hasResources;
  }).length;

  // 총 서브계정 수 계산
  const totalSubAccounts = useMemo(() => {
    return accounts.reduce((sum, acc) => sum + (acc._count?.subAccounts || 0), 0);
  }, [accounts]);

  // 총 비용 계산 (선택 월이 있으면 historicalCostMap 사용)
  // 마스터 계정이 있으면 이중집계 방지: 마스터 비용(조직 합계)만 사용
  const isCurrentMonth = !selectedYearMonth || selectedYearMonth === getCurrentYearMonth();
  const masterAccount = useMemo(() => accounts.find(a => a.isMaster), [accounts]);
  const totalCourseCost = useMemo(() => {
    if (!isCurrentMonth) {
      if (isFetchingHistory || Object.keys(historicalCostMap).length === 0) return null;
      // 마스터 계정이 있고 비용 데이터가 있으면 마스터 기준 합계 사용 (이중집계 방지)
      if (masterAccount && historicalCostMap[masterAccount.id]?.totalCost > 0) {
        return historicalCostMap[masterAccount.id].totalCost;
      }
      return Object.values(historicalCostMap).reduce((sum, data) => sum + (data.totalCost || 0), 0);
    }
    // 현재 월: 마스터 계정 기준 우선 사용
    if (masterAccount && (accountResourceMap[masterAccount.id]?.totalCost ?? 0) > 0) {
      return accountResourceMap[masterAccount.id].totalCost;
    }
    return Object.values(accountResourceMap).reduce((sum, data) => sum + (data.totalCost || 0), 0);
  }, [accountResourceMap, historicalCostMap, isCurrentMonth, isFetchingHistory, masterAccount]);

  // 리소스 보유 계정 수
  const accountsWithResourcesCount = useMemo(() => {
    return Object.values(accountResourceMap).filter(r => r.totalResourceCount > 0).length;
  }, [accountResourceMap]);

  // 계정별 전체 누적 비용 맵 (accountId → cost)
  const cumulativeAccountCostMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (cumulativeCosts?.byAccount) {
      for (const entry of cumulativeCosts.byAccount) {
        map[entry.accountId] = entry.cost;
      }
    }
    return map;
  }, [cumulativeCosts]);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!course) {
    return <div className="text-center text-gray-500">과정을 찾을 수 없습니다.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link to="/courses" className="hover:text-ncp-primary">과정 관리</Link>
            <ChevronRightIcon className="h-4 w-4" />
            <span>{course.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{course.name}</h1>
            <StatusBadge status={course.status} type="course" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 전체 동기화 */}
          <button
            onClick={handleSyncEverything}
            disabled={isSyncingAll}
            className="btn-primary flex items-center gap-1.5"
          >
            <ArrowPathIcon className={`h-4 w-4 ${isSyncingAll ? 'animate-spin' : ''}`} />
            {isSyncingAll ? '동기화 중...' : '전체 동기화'}
          </button>

          {/* 결과 보기 */}
          {syncResults.length > 0 && (
            <button
              onClick={() => setIsSyncResultModalOpen(true)}
              className="btn-secondary text-sm"
            >
              결과 보기
            </button>
          )}

          {/* 내보내기 */}
          <div className="relative">
            <button
              onClick={() => { setIsExportMenuOpen(!isExportMenuOpen); setIsManageMenuOpen(false); setIsDeleteMenuOpen(false); }}
              className="btn-secondary flex items-center gap-1"
            >
              <DocumentArrowDownIcon className="h-4 w-4" />
              내보내기
              <ChevronDownIcon className="h-3.5 w-3.5" />
            </button>
            {isExportMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setIsExportMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-52 bg-white rounded-lg shadow-lg border z-20 py-1">
                  <button onClick={() => handleExport('accounts')} className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100">
                    계정 목록 (CSV)
                  </button>
                  <button onClick={() => handleExport('accounts_subaccounts')} className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100">
                    계정 + 서브계정 (CSV)
                  </button>
                  <button onClick={() => handleExport('costs')} className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100">
                    {isCurrentMonth ? '비용 리포트 (CSV)' : `${formatYearMonth(selectedYearMonth)} 비용 (CSV)`}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* 관리 드롭다운 (이름 일괄 변경, 회원번호 설정) */}
          {canEdit && accounts.length > 0 && (
            <div className="relative">
              <button
                onClick={() => { setIsManageMenuOpen(!isManageMenuOpen); setIsExportMenuOpen(false); setIsDeleteMenuOpen(false); }}
                className="btn-secondary flex items-center gap-1"
              >
                <PencilIcon className="h-4 w-4" />
                관리
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </button>
              {isManageMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsManageMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border z-20 py-1">
                    <button
                      onClick={() => { setIsBulkRenameModalOpen(true); setIsManageMenuOpen(false); }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
                    >
                      <PencilIcon className="h-4 w-4 text-gray-400" />
                      이름 일괄 변경
                    </button>
                    <button
                      onClick={() => { setIsMemberNoModalOpen(true); setIsManageMenuOpen(false); }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
                    >
                      <KeyIcon className="h-4 w-4 text-gray-400" />
                      회원번호 설정
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 일괄 삭제 드롭다운 (서브계정 / 리소스) */}
          {canDelete && (totalSubAccounts > 0 || accountsWithResourcesCount > 0) && (
            <div className="relative">
              <button
                onClick={() => { setIsDeleteMenuOpen(!isDeleteMenuOpen); setIsExportMenuOpen(false); setIsManageMenuOpen(false); }}
                className="btn-danger flex items-center gap-1"
              >
                <TrashIcon className="h-4 w-4" />
                일괄 삭제
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </button>
              {isDeleteMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsDeleteMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-52 bg-white rounded-lg shadow-lg border z-20 py-1">
                    {totalSubAccounts > 0 && (
                      <button
                        onClick={() => { setIsBulkDeleteModalOpen(true); setIsDeleteMenuOpen(false); }}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2"
                      >
                        <TrashIcon className="h-4 w-4" />
                        서브계정 일괄 삭제
                      </button>
                    )}
                    {accountsWithResourcesCount > 0 && (
                      <button
                        onClick={() => { setIsBulkCleanupModalOpen(true); setIsDeleteMenuOpen(false); }}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2"
                      >
                        <TrashIcon className="h-4 w-4" />
                        리소스 일괄 삭제
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* 계정 일괄 추가 */}
          {canEdit && (
            <button
              onClick={() => setIsBulkAddModalOpen(true)}
              className="btn-primary flex items-center gap-1.5"
            >
              <PlusIcon className="h-4 w-4" />
              계정 일괄 추가
            </button>
          )}
        </div>
      </div>

      {/* Course Info — stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          {
            label: '기간',
            value: `${formatDateOnly(course.startDate)} ~ ${formatDateOnly(course.endDate)}`,
            small: true,
          },
          { label: '등록 계정', value: `${accounts.length}개`, color: 'text-gray-900' },
          { label: '총 서브계정', value: `${totalSubAccounts}개`, color: 'text-ncp-primary' },
          {
            label: '리소스 보유',
            value: Object.keys(accountResourceMap).length > 0 ? `${accountsWithResourcesCount}개` : '-',
            color: accountsWithResourcesCount > 0 ? 'text-orange-500' : 'text-gray-400',
            sub: Object.keys(accountResourceMap).length > 0 && Object.keys(accountResourceMap).length < accounts.length
              ? `${Object.keys(accountResourceMap).length}/${accounts.length} 조회됨` : undefined,
          },
          {
            label: isCurrentMonth ? '이번 달 비용 (VAT 제외)' : `${formatYearMonth(selectedYearMonth)} 비용 (VAT 제외)`,
            value: isFetchingHistory ? '조회 중...' : totalCourseCost != null ? (totalCourseCost > 0 ? formatCostExact(totalCourseCost) : '-') : '미조회',
            color: isFetchingHistory || totalCourseCost == null ? 'text-gray-400' : totalCourseCost > 0 ? 'text-ncp-primary' : 'text-gray-400',
          },
          {
            label: '전체 사용료',
            custom: (
              <div>
                {isFetchingCumulative ? (
                  <p className="text-sm font-semibold text-gray-400">조회 중...</p>
                ) : cumulativeCosts ? (
                  <>
                    <p className="text-sm font-bold text-blue-700">
                      {cumulativeCosts.totalCost > 0 ? formatCostExact(cumulativeCosts.totalCost) : '-'}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {cumulativeCosts.startMonth === cumulativeCosts.endMonth
                        ? `${formatYearMonth(cumulativeCosts.startMonth ?? '')} (VAT 제외)`
                        : `${cumulativeCosts.periods}개월 누적 (VAT 제외)`}
                    </p>
                  </>
                ) : (
                  <button
                    onClick={handleFetchCumulativeCosts}
                    disabled={isFetchingCumulative}
                    className="text-xs text-ncp-primary hover:underline mt-0.5"
                  >
                    조회하기
                  </button>
                )}
              </div>
            ),
          },
        ].map((item, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-card px-4 py-3">
            <p className="text-xs text-gray-400 mb-1">{item.label}</p>
            {item.custom ?? (
              <>
                <p className={`font-semibold ${item.small ? 'text-xs text-gray-700' : 'text-sm'} ${item.color || 'text-gray-900'}`}>
                  {item.value}
                </p>
                {item.sub && <p className="text-xs text-gray-400 mt-0.5">{item.sub}</p>}
              </>
            )}
          </div>
        ))}
      </div>
      {course.description && (
        <div className="card py-3 px-4">
          <p className="text-sm text-gray-500">{course.description}</p>
        </div>
      )}

      {/* Accounts List */}
      <div className="card">
        {/* 월 선택 */}
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
          <span className="text-sm font-medium text-gray-700">조회 기간:</span>
          <select
            value={selectedYearMonth}
            onChange={(e) => {
              const newMonth = e.target.value;
              setSelectedYearMonth(newMonth);
              setHistoricalCostMap({});
              // 과거 월 선택 시 자동 조회
              const currentYM = getCurrentYearMonth();
              if (newMonth && newMonth !== currentYM && accounts.length > 0) {
                handleFetchHistoricalCosts(newMonth);
              }
            }}
            className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ncp-primary"
          >
            {monthOptions.map(opt => (
              <option key={opt.value} value={opt.value === getCurrentYearMonth() ? '' : opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {!isCurrentMonth && (
            <button
              onClick={() => handleFetchHistoricalCosts()}
              disabled={isFetchingHistory}
              className="flex items-center gap-1 px-3 py-1 text-sm bg-ncp-primary text-white rounded hover:bg-ncp-secondary disabled:opacity-50"
            >
              <ArrowPathIcon className={`h-3.5 w-3.5 ${isFetchingHistory ? 'animate-spin' : ''}`} />
              {isFetchingHistory ? '조회 중...' : '비용 조회'}
            </button>
          )}
          {!isCurrentMonth && Object.keys(historicalCostMap).length > 0 && (
            <span className="text-xs text-gray-400">
              {Object.keys(historicalCostMap).length}개 계정 조회됨
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleFetchCumulativeCosts}
              disabled={isFetchingCumulative}
              className="flex items-center gap-1 px-3 py-1 text-sm bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 disabled:opacity-50 font-medium"
            >
              <ArrowPathIcon className={`h-3.5 w-3.5 ${isFetchingCumulative ? 'animate-spin' : ''}`} />
              {isFetchingCumulative ? '조회 중...' : cumulativeCosts ? '전체 사용료 새로고침' : '전체 사용료 조회'}
            </button>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900">등록된 계정</h2>
            {hiddenCount > 0 && (
              <button
                onClick={() => setShowAllAccounts(!showAllAccounts)}
                className="text-sm text-gray-500 hover:text-ncp-primary"
              >
                {showAllAccounts ? `서브계정 없는 ${hiddenCount}개 숨기기` : `숨김 ${hiddenCount}개 표시`}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* 검색창 */}
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="계정 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input pl-9 py-1.5 w-48 text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              )}
            </div>
            {canEdit && (
              <button
                onClick={() => setIsAddAccountModalOpen(true)}
                className="btn-secondary text-sm flex items-center"
              >
                <PlusIcon className="h-4 w-4 mr-1" />
                계정 추가
              </button>
            )}
          </div>
        </div>

        {filteredAccounts.length === 0 ? (
          <div className="text-center py-10 text-gray-500">
            {accounts.length === 0 ? (
              <div className="space-y-2">
                <p className="font-medium">등록된 계정이 없습니다.</p>
                <p className="text-sm text-gray-400">우측 상단의 &quot;계정 추가&quot; 또는 &quot;일괄 추가&quot; 버튼으로 NCP 계정을 등록하세요.</p>
              </div>
            ) : debouncedSearchQuery ? (
              <p>&quot;{debouncedSearchQuery}&quot;와 일치하는 계정이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                <p className="font-medium">서브계정 또는 리소스가 있는 계정이 없습니다.</p>
                <p className="text-sm text-gray-400">&quot;전체 동기화&quot;를 실행하면 서브계정과 리소스 정보를 불러옵니다.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="table-header rounded-tl-lg">이름</th>
                  <th className="table-header">Access Key</th>
                  <th className="table-header text-center">서브계정</th>
                  <th className="table-header text-center">리소스</th>
                  <th className="table-header text-right">
                    {isCurrentMonth ? '이번 달 비용' : `${formatYearMonth(selectedYearMonth)} 비용`}
                    <span className="block text-[10px] font-normal text-gray-400">VAT 제외</span>
                  </th>
                  <th className="table-header text-right rounded-tr-lg">
                    전체 사용료
                    <span className="block text-[10px] font-normal text-gray-400">과정 시작~현재, VAT 제외</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    onRefresh={loadCourse}
                    canEdit={canEdit}
                    resourceData={accountResourceMap[account.id] || null}
                    historicalCostData={!isCurrentMonth ? (historicalCostMap[account.id] || null) : null}
                    isCurrentMonth={isCurrentMonth}
                    cumulativeCost={cumulativeAccountCostMap[account.id] ?? null}
                    onResourceUpdate={(resources, totalResourceCount, totalCost) => {
                      setAccountResourceMap(prev => ({
                        ...prev,
                        [account.id]: { resources, totalResourceCount, totalCost, lastSynced: new Date() }
                      }));
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Account Modal */}
      <AddAccountModal
        isOpen={isAddAccountModalOpen}
        onClose={() => setIsAddAccountModalOpen(false)}
        courseId={courseId!}
        onSuccess={() => {
          setIsAddAccountModalOpen(false);
          loadCourse();
        }}
      />

      {/* Bulk Add Modal */}
      <BulkAddAccountModal
        isOpen={isBulkAddModalOpen}
        onClose={() => setIsBulkAddModalOpen(false)}
        courseId={courseId!}
        onSuccess={() => {
          setIsBulkAddModalOpen(false);
          loadCourse();
        }}
      />

      {/* Bulk Rename Modal */}
      <BulkRenameModal
        isOpen={isBulkRenameModalOpen}
        onClose={() => setIsBulkRenameModalOpen(false)}
        courseId={courseId!}
        accountCount={accounts.length}
        onSuccess={() => {
          setIsBulkRenameModalOpen(false);
          loadCourse();
        }}
      />

      {/* Sync Result Modal */}
      <SyncResultModal
        isOpen={isSyncResultModalOpen}
        onClose={() => setIsSyncResultModalOpen(false)}
        results={syncResults}
      />

      {/* Bulk Delete Modal */}
      <BulkDeleteModal
        isOpen={isBulkDeleteModalOpen}
        onClose={() => setIsBulkDeleteModalOpen(false)}
        accounts={accounts}
        courseId={courseId!}
        onSuccess={() => {
          setIsBulkDeleteModalOpen(false);
          loadCourse();
        }}
      />

      {/* Bulk Cleanup Modal */}
      <BulkCleanupModal
        isOpen={isBulkCleanupModalOpen}
        onClose={() => setIsBulkCleanupModalOpen(false)}
        accounts={accounts}
        courseId={courseId!}
        accountResourceMap={accountResourceMap}
        onSuccess={() => {
          setIsBulkCleanupModalOpen(false);
          loadCourse();
        }}
      />

      {/* Member Number Modal */}
      <MemberNoModal
        isOpen={isMemberNoModalOpen}
        onClose={() => setIsMemberNoModalOpen(false)}
        courseId={courseId!}
        accounts={accounts}
        onSuccess={() => {
          setIsMemberNoModalOpen(false);
          loadCourse();
        }}
      />
    </div>
  );
}

function AccountRow({
  account,
  onRefresh,
  canEdit,
  resourceData,
  historicalCostData,
  isCurrentMonth,
  cumulativeCost,
  onResourceUpdate
}: {
  account: NcpAccount;
  onRefresh: () => void;
  canEdit: boolean;
  resourceData: AccountResourceData | null;
  historicalCostData: { totalCost: number; products: Array<{ productCode: string; productName: string; useAmount: number; demandAmount: number }> } | null;
  isCurrentMonth: boolean;
  cumulativeCost: number | null;
  onResourceUpdate: (resources: Record<string, number>, totalResourceCount: number, totalCost: number) => void;
}) {
  const handleToggleMaster = async () => {
    try {
      if (account.isMaster) {
        await accountApi.unsetMaster(account.id);
        toast.success('마스터 계정이 해제되었습니다');
      } else {
        await accountApi.setMaster(account.id);
        toast.success('마스터 계정으로 지정되었습니다');
      }
      onRefresh();
    } catch {
      toast.error('마스터 계정 설정에 실패했습니다');
    }
  };
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(account.displayName || '');
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);

  const handleSyncResources = async () => {
    setIsLoading(true);
    try {
      // 리소스와 비용을 병렬로 조회
      const [resourceRes, costRes] = await Promise.allSettled([
        accountApi.syncResources(account.id),
        accountApi.getCosts(account.id)
      ]);

      const resources: Record<string, number> = {};
      if (resourceRes.status === 'fulfilled' && resourceRes.value.success && resourceRes.value.data) {
        const data = resourceRes.value.data as Record<string, unknown>;
        const resourceDataResult = (data.resources || data) as Record<string, number>;
        // subAccounts는 리소스에서 제외 (서브계정은 별도 컬럼에 표시됨)
        Object.entries(resourceDataResult).forEach(([key, value]) => {
          if (key === 'subAccounts') return; // 서브계정 제외
          if (typeof value === 'number' && value > 0) {
            resources[key] = value;
          }
        });
      }

      let totalCost = 0;
      if (costRes.status === 'fulfilled' && costRes.value.success && costRes.value.data) {
        const costData = costRes.value.data as { totalUseAmount?: number; totalDemandAmount?: number; invoiceDemandAmount?: number };
        totalCost = costData.invoiceDemandAmount ?? costData.totalDemandAmount ?? costData.totalUseAmount ?? 0;
      }

      const totalResourceCount = Object.values(resources).reduce((sum, count) => sum + count, 0);
      onResourceUpdate(resources, totalResourceCount, totalCost);
      setIsExpanded(true);
      toast.success('리소스 정보를 가져왔습니다');
    } catch (error) {
      toast.error('리소스 정보를 가져오는데 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveName = async () => {
    const trimmed = editName.trim();
    if (!trimmed) {
      toast.error('이름을 입력해주세요');
      return;
    }
    try {
      await accountApi.update(account.id, { displayName: trimmed });
      toast.success('이름이 수정되었습니다');
      setIsEditingName(false);
      onRefresh();
    } catch (error) {
      toast.error('이름 수정에 실패했습니다');
    }
  };

  const handleCancelEdit = () => {
    setEditName(account.displayName || '');
    setIsEditingName(false);
  };

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50 group">
        <td className="py-3 px-4">
          {isEditingName ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                className="input py-1 px-2 text-sm w-32"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') handleCancelEdit();
                }}
                autoFocus
              />
              <button onClick={handleSaveName} className="p-1 text-green-600 hover:bg-green-50 rounded">
                <CheckIcon className="h-4 w-4" />
              </button>
              <button onClick={handleCancelEdit} className="p-1 text-gray-400 hover:bg-gray-100 rounded">
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                to={`/accounts/${account.id}`}
                className="font-medium text-gray-900 hover:text-ncp-primary"
              >
                {account.displayName || '-'}
              </Link>
              {account.isMaster && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-purple-100 text-purple-700 rounded border border-purple-200">
                  마스터
                </span>
              )}
              {account.ncpMemberNo && !account.isMaster && (
                <span className="text-[10px] text-gray-400 font-mono">#{account.ncpMemberNo}</span>
              )}
              {canEdit && (
                <>
                  <button
                    onClick={() => setIsEditingName(true)}
                    className="p-1 text-gray-400 hover:text-ncp-primary rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    title="이름 수정"
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={handleToggleMaster}
                    className={`px-1.5 py-0.5 text-[10px] rounded border opacity-0 group-hover:opacity-100 transition-opacity ${
                      account.isMaster
                        ? 'text-purple-600 border-purple-300 hover:bg-purple-50'
                        : 'text-gray-400 border-gray-300 hover:bg-gray-50'
                    }`}
                    title={account.isMaster ? '마스터 해제' : '마스터로 지정'}
                  >
                    {account.isMaster ? '해제' : '마스터'}
                  </button>
                </>
              )}
            </div>
          )}
        </td>
        <td className="py-3 px-4 text-sm text-gray-500 font-mono">
          <div className="flex items-center gap-1">
            <span>{account.accessKeyHash?.substring(0, 12)}...</span>
            {canEdit && (
              <button
                onClick={() => setIsKeyModalOpen(true)}
                className="p-1 text-gray-400 hover:text-ncp-primary rounded"
                title="API 키 수정"
              >
                <KeyIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        </td>
        <td className="py-3 px-4 text-center text-sm font-medium">
          {account._count?.subAccounts || 0}
        </td>
        <td className="py-3 px-4 text-center">
          <div className="flex items-center justify-center gap-1">
            <button
              onClick={handleSyncResources}
              disabled={isLoading}
              className="p-1.5 text-gray-400 hover:text-ncp-primary hover:bg-gray-100 rounded"
              title="리소스 조회"
            >
              <ArrowPathIcon className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            {(resourceData || (!isCurrentMonth && historicalCostData)) && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1.5 text-gray-400 hover:text-ncp-primary hover:bg-gray-100 rounded"
                title={isExpanded ? '접기' : '펼치기'}
              >
                {isExpanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
              </button>
            )}
            {isCurrentMonth && resourceData && (
              <span className={`ml-1 text-xs font-medium ${resourceData.totalResourceCount > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                {resourceData.totalResourceCount}개
              </span>
            )}
            {!isCurrentMonth && historicalCostData && (
              <span className={`ml-1 text-xs font-medium ${historicalCostData.products.length > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                {historicalCostData.products.length}종
              </span>
            )}
          </div>
        </td>
        <td className="py-3 px-4 text-right">
          {!isCurrentMonth ? (
            historicalCostData ? (
              historicalCostData.totalCost > 0 ? (
                <span className="font-medium text-ncp-primary">{formatCostExact(historicalCostData.totalCost)}</span>
              ) : (
                <span className="text-gray-400 text-sm">0원</span>
              )
            ) : (
              <span className="text-gray-300 text-sm">-</span>
            )
          ) : (
            resourceData?.totalCost && resourceData.totalCost > 0 ? (
              <span className="font-medium text-ncp-primary">{formatCostExact(resourceData.totalCost)}</span>
            ) : resourceData ? (
              <span className="text-gray-400 text-sm">0원</span>
            ) : (
              <span className="text-gray-300 text-sm">-</span>
            )
          )}
        </td>
        <td className="py-3 px-4 text-right">
          {cumulativeCost != null ? (
            cumulativeCost > 0 ? (
              <span className="font-bold text-blue-700">{formatCostExact(cumulativeCost)}</span>
            ) : (
              <span className="text-gray-400 text-sm">0원</span>
            )
          ) : (
            <span className="text-gray-300 text-sm">-</span>
          )}
        </td>
      </tr>

      {/* Expanded Resources / Historical Services Row */}
      {isExpanded && (isCurrentMonth ? resourceData : (resourceData || historicalCostData)) && (
        <tr className="bg-gray-50">
          <td colSpan={6} className="px-4 py-3">
            <div className="pl-4 space-y-3">
              {/* 현재 월: 현재 보유 리소스 표시 */}
              {isCurrentMonth && resourceData && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">현재 보유 리소스:</p>
                  {Object.keys(resourceData.resources).length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(resourceData.resources).map(([type, count]) => (
                        <span
                          key={type}
                          className="px-2 py-1 bg-white border border-gray-200 text-xs text-gray-700 rounded"
                        >
                          {type}: <span className="font-medium text-red-600">{count}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-green-600">보유 중인 리소스가 없습니다 ✓</p>
                  )}
                </div>
              )}

              {/* 과거 월: 사용 서비스 및 비용 표시 */}
              {!isCurrentMonth && historicalCostData && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">해당 월 사용 서비스:</p>
                  {historicalCostData.products.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {historicalCostData.products.map((product) => (
                        <span
                          key={product.productCode}
                          className="px-2 py-1 bg-white border border-blue-200 text-xs text-gray-700 rounded"
                        >
                          {product.productName}:{' '}
                          <span className="font-medium text-blue-600">
                            {formatCostExact(product.demandAmount || product.useAmount)}
                          </span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">해당 월 사용 내역이 없습니다</p>
                  )}
                </div>
              )}

              {/* 과거 월이지만 아직 조회 안 된 경우 */}
              {!isCurrentMonth && !historicalCostData && resourceData && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">현재 보유 리소스 (과거 비용 조회 필요):</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(resourceData.resources).map(([type, count]) => (
                      <span
                        key={type}
                        className="px-2 py-1 bg-white border border-gray-200 text-xs text-gray-700 rounded"
                      >
                        {type}: <span className="font-medium text-red-600">{count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}

      {/* API Key Edit Modal */}
      <EditApiKeyModal
        isOpen={isKeyModalOpen}
        account={account}
        onClose={() => setIsKeyModalOpen(false)}
        onSuccess={() => {
          setIsKeyModalOpen(false);
          onRefresh();
        }}
      />
    </>
  );
}

