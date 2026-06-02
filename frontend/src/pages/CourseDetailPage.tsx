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
import AccountRow from '../components/course/AccountRow';


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
        // localStorage 로드 실패 — 무시
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

  // 전체 누적 사용료 (NCP billing API 직접 조회 or DB 캐시)
  const [cumulativeCosts, setCumulativeCosts] = useState<{
    totalCost: number;
    periods: number;
    startMonth?: string;
    endMonth?: string;
    byAccount: Array<{ accountId: string; accountName: string; cost: number }>;
  } | null>(null);
  const [isFetchingCumulative, setIsFetchingCumulative] = useState(false);
  const [cumulativeUpdatedAt, setCumulativeUpdatedAt] = useState<string | null>(null);

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
        // localStorage 저장 실패 — 무시
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
        // DB 캐시 값이 있으면 즉시 표시
        if (response.data.totalCumulativeCost != null) {
          setCumulativeCosts({
            totalCost: response.data.totalCumulativeCost,
            periods: 0,
            byAccount: []
          });
          setCumulativeUpdatedAt(response.data.cumulativeCostUpdatedAt ?? null);
        }
      }
    } catch (error) {
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
            lastSynced: new Date(),
            services: result.services || []
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
        setCumulativeUpdatedAt(new Date().toISOString());
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
  // DB 캐시(account.totalCumulativeCost)를 기본값으로, 직접 조회 결과로 덮어씌움
  const cumulativeAccountCostMap = useMemo(() => {
    const map: Record<string, number> = {};
    // 1. DB 캐시 먼저 채움
    for (const acc of accounts) {
      if (acc.totalCumulativeCost != null) {
        map[acc.id] = acc.totalCumulativeCost;
      }
    }
    // 2. 직접 조회 결과로 덮어씌움 (더 최신)
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
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-bold text-blue-700">
                        {cumulativeCosts.totalCost > 0 ? formatCostExact(cumulativeCosts.totalCost) : '-'}
                      </p>
                      <button
                        onClick={handleFetchCumulativeCosts}
                        disabled={isFetchingCumulative}
                        className="text-gray-300 hover:text-gray-500"
                        title="새로고침"
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {cumulativeCosts.periods > 0
                        ? `${cumulativeCosts.periods}개월 누적 (VAT 제외)`
                        : 'VAT 제외'}
                      {cumulativeUpdatedAt && ` · ${(() => {
                        const diff = Math.floor((Date.now() - new Date(cumulativeUpdatedAt).getTime()) / 86400000);
                        return diff === 0 ? '오늘 업데이트' : `${diff}일 전 업데이트`;
                      })()}`}
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
              title="과정 시작~현재까지 계정별 누적 비용을 NCP API에서 다시 조회합니다"
            >
              <ArrowPathIcon className={`h-3.5 w-3.5 ${isFetchingCumulative ? 'animate-spin' : ''}`} />
              {isFetchingCumulative ? '조회 중...' : '전체 사용료 새로고침'}
            </button>
          </div>
        </div>
        {/* 전체 이용 서비스 현황 */}
        {Object.keys(accountResourceMap).length > 0 && (() => {
          const serviceCount: Record<string, number> = {};
          for (const data of Object.values(accountResourceMap)) {
            for (const svc of data.services ?? []) {
              serviceCount[svc] = (serviceCount[svc] ?? 0) + 1;
            }
          }
          const uniqueServices = Object.entries(serviceCount).sort((a, b) => b[1] - a[1]);
          if (uniqueServices.length === 0) return null;
          return (
            <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">
                전체 계정 이용 중인 구독 서비스
              </p>
              <div className="flex flex-wrap gap-1.5">
                {uniqueServices.map(([name, count]) => (
                  <span key={name} className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-amber-200 text-amber-800 text-xs font-medium rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                    {name}
                    {count > 1 && <span className="text-amber-500 font-bold ml-0.5">×{count}</span>}
                  </span>
                ))}
              </div>
            </div>
          );
        })()}

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
