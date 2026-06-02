import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  ClockIcon,
  AcademicCapIcon,
  UserGroupIcon,
  CreditCardIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { courseApi, monitoringApi } from '../services/api';
import type { Course, CreditsData } from '../types';
import LoadingSpinner from '../components/LoadingSpinner';
import StatusBadge from '../components/StatusBadge';
import { formatDateOnly, formatCostExact } from '../utils/format';

function daysSince(dateStr: string): number {
  const end = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - end.getTime()) / (1000 * 60 * 60 * 24));
}

function daysUntil(dateStr: string): number {
  const end = new Date(dateStr);
  const now = new Date();
  return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export default function DashboardPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [credits, setCredits] = useState<CreditsData | null>(null);
  const [isLoadingCredits, setIsLoadingCredits] = useState(false);

  useEffect(() => {
    courseApi.list().then(res => {
      if (res.success && res.data) setCourses(res.data);
    }).catch(() => {}).finally(() => setIsLoading(false));
  }, []);

  const loadCredits = useCallback((refresh = false) => {
    setIsLoadingCredits(true);
    monitoringApi.getCredits(refresh).then(res => {
      if (res.success && res.data) setCredits(res.data);
    }).catch(() => {}).finally(() => setIsLoadingCredits(false));
  }, []);

  useEffect(() => { loadCredits(); }, [loadCredits]);

  const completedWithAccounts = useMemo(() =>
    courses
      .filter(c => (c.status === 'COMPLETED' || c.status === 'ARCHIVED') && (c._count?.accounts || 0) > 0)
      .sort((a, b) => daysSince(b.endDate) - daysSince(a.endDate)),
    [courses]
  );

  const endingSoon = useMemo(() =>
    courses
      .filter(c => c.status === 'ACTIVE' && daysUntil(c.endDate) <= 7 && daysUntil(c.endDate) >= 0)
      .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime()),
    [courses]
  );

  const activeCourses = courses.filter(c => c.status === 'ACTIVE');
  const totalAccounts = courses.reduce((s, c) => s + (c._count?.accounts || 0), 0);
  const needsCleanup = completedWithAccounts.length > 0;

  // 경고 조건
  const criticalCredits = credits?.accounts.filter(a =>
    a.success && a.totalCredit > 0 && (a.usedCredit / a.totalCredit) >= 0.8
  ) ?? [];
  const urgentEndingSoon = endingSoon.filter(c => daysUntil(c.endDate) <= 3);
  const hasAlerts = criticalCredits.length > 0 || urgentEndingSoon.length > 0;

  // 크레딧 계정 정렬: 사용률 높은 순
  const sortedCreditAccounts = useMemo(() =>
    [...(credits?.accounts ?? [])].sort((a, b) => {
      const pA = a.totalCredit > 0 ? a.usedCredit / a.totalCredit : 0;
      const pB = b.totalCredit > 0 ? b.usedCredit / b.totalCredit : 0;
      return pB - pA;
    }),
    [credits]
  );

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">대시보드</h1>
        <p className="text-sm text-gray-500 mt-0.5">NCP 교육 계정 운영 현황</p>
      </div>

      {/* 경고 배너 */}
      {hasAlerts && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <ExclamationTriangleIcon className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            {criticalCredits.map(a => (
              <p key={a.accountId} className="text-sm text-red-700 font-medium">
                <span className="font-semibold">{a.courseName}</span> — 크레딧{' '}
                {((a.usedCredit / a.totalCredit) * 100).toFixed(0)}% 소진
                <span className="font-normal text-red-500"> (잔여 {formatCostExact(a.remainCredit)})</span>
              </p>
            ))}
            {urgentEndingSoon.map(c => (
              <p key={c.id} className="text-sm text-red-700 font-medium">
                <span className="font-semibold">{c.name}</span> —{' '}
                {daysUntil(c.endDate) === 0 ? 'D-Day' : `D-${daysUntil(c.endDate)}`} 종료 예정
              </p>
            ))}
          </div>
        </div>
      )}

      {/* 요약 카드 4개 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">진행 중인 과정</p>
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <AcademicCapIcon className="h-4 w-4 text-blue-500" />
            </div>
          </div>
          <p className="text-3xl font-bold text-gray-900">{activeCourses.length}<span className="text-sm font-normal text-gray-400 ml-1">개</span></p>
          {endingSoon.length > 0
            ? <p className="text-xs text-amber-600 mt-2 font-medium">{endingSoon.length}개 7일 내 종료</p>
            : <p className="text-xs text-gray-400 mt-2">종료 임박 없음</p>
          }
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">전체 계정</p>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
              <UserGroupIcon className="h-4 w-4 text-indigo-500" />
            </div>
          </div>
          <p className="text-3xl font-bold text-gray-900">{totalAccounts}<span className="text-sm font-normal text-gray-400 ml-1">개</span></p>
          <p className="text-xs text-gray-400 mt-2">전체 {courses.length}개 과정</p>
        </div>

        <div className={`rounded-xl border p-4 shadow-sm ${needsCleanup ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
          <div className="flex items-center justify-between mb-3">
            <p className={`text-xs font-medium uppercase tracking-wide ${needsCleanup ? 'text-red-500' : 'text-green-600'}`}>정리 필요 과정</p>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${needsCleanup ? 'bg-red-100' : 'bg-green-100'}`}>
              {needsCleanup
                ? <ExclamationTriangleIcon className="h-4 w-4 text-red-500" />
                : <CheckCircleIcon className="h-4 w-4 text-green-500" />
              }
            </div>
          </div>
          <p className={`text-3xl font-bold ${needsCleanup ? 'text-red-600' : 'text-green-600'}`}>
            {completedWithAccounts.length}<span className="text-sm font-normal text-gray-400 ml-1">개</span>
          </p>
          {needsCleanup
            ? <p className="text-xs text-red-500 mt-2 font-medium">계정 {completedWithAccounts.reduce((s, c) => s + (c._count?.accounts || 0), 0)}개 잔여</p>
            : <p className="text-xs text-green-600 mt-2 font-medium flex items-center gap-1"><CheckCircleIcon className="h-3 w-3" />모두 정리 완료</p>
          }
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">잔여 크레딧</p>
            <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
              <CreditCardIcon className="h-4 w-4 text-purple-500" />
            </div>
          </div>
          {isLoadingCredits && !credits
            ? <p className="text-sm text-gray-400 mt-1">조회 중...</p>
            : <p className="text-2xl font-bold text-purple-700">{formatCostExact(credits?.remainCredit ?? 0)}</p>
          }
          {credits && credits.totalCredit > 0 && (
            <p className="text-xs text-gray-400 mt-2">
              총 {formatCostExact(credits.totalCredit)} 중 {((credits.usedCredit / credits.totalCredit) * 100).toFixed(0)}% 사용
            </p>
          )}
        </div>
      </div>

      {/* NCP 크레딧 현황 (compact) */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CreditCardIcon className="h-4 w-4 text-purple-500" />
            <h2 className="text-sm font-semibold text-gray-900">NCP 크레딧 현황</h2>
            <span className="text-xs text-gray-400">(마스터 계정 기준)</span>
          </div>
          <button
            onClick={() => loadCredits(true)}
            disabled={isLoadingCredits}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="새로고침"
          >
            <ArrowPathIcon className={`h-4 w-4 ${isLoadingCredits ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {isLoadingCredits && !credits ? (
          <p className="text-sm text-gray-400 text-center py-4">크레딧 조회 중...</p>
        ) : !credits || credits.accounts.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">크레딧 정보가 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {sortedCreditAccounts.map(acc => {
              const pct = acc.totalCredit > 0 ? Math.min(100, (acc.usedCredit / acc.totalCredit) * 100) : 0;
              const isWarn = pct >= 80;
              const isCrit = pct >= 90;
              const barColor = isCrit ? 'bg-red-500' : isWarn ? 'bg-amber-500' : 'bg-purple-500';
              const textColor = isCrit ? 'text-red-600' : isWarn ? 'text-amber-600' : 'text-purple-600';

              return (
                <div key={acc.accountId} className="flex items-center gap-4">
                  {/* 과정명 */}
                  <div className="w-44 shrink-0">
                    <p className="text-xs font-medium text-gray-700 truncate">{acc.courseName}</p>
                    {acc.credits[0]?.expireMonth && (
                      <p className="text-[10px] text-gray-400">~{acc.credits[0].expireMonth}</p>
                    )}
                  </div>

                  {/* 진행바 */}
                  <div className="flex-1 min-w-0">
                    {acc.totalCredit > 0 ? (
                      <>
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div className={`${barColor} h-2 rounded-full transition-all`} style={{ width: `${pct.toFixed(1)}%` }} />
                        </div>
                        <div className="flex justify-between mt-0.5">
                          <span className="text-[10px] text-gray-400">{pct.toFixed(1)}% 사용</span>
                          {isWarn && (
                            <span className={`text-[10px] font-semibold ${textColor}`}>
                              {isCrit ? '⚠ 거의 소진' : '주의'}
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-gray-400">크레딧 없음</p>
                    )}
                  </div>

                  {/* 잔여 / 총액 */}
                  <div className="text-right shrink-0 w-40">
                    {acc.success ? (
                      <>
                        <p className={`text-xs font-semibold ${textColor}`}>잔여 {formatCostExact(acc.remainCredit)}</p>
                        {acc.totalCredit > 0 && (
                          <p className="text-[10px] text-gray-400">/ {formatCostExact(acc.totalCredit)}</p>
                        )}
                      </>
                    ) : (
                      <p className="text-[11px] text-red-400">조회 실패</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 메인 콘텐츠: 정리 필요 + 우측 패널 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 정리 필요 과정 목록 */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center gap-2">
            <ExclamationTriangleIcon className="h-5 w-5 text-red-500" />
            <h2 className="text-sm font-semibold text-gray-900">종료 과정 — 정리 필요</h2>
            <span className="text-xs text-gray-400">(계정이 남아있는 완료/보관 과정)</span>
          </div>

          {completedWithAccounts.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center py-12 text-center shadow-sm">
              <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mb-3">
                <CheckCircleIcon className="h-7 w-7 text-green-400" />
              </div>
              <p className="font-medium text-gray-700">정리가 필요한 과정이 없습니다</p>
              <p className="text-sm text-gray-400 mt-1">종료된 과정의 계정이 모두 정리되었습니다.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {completedWithAccounts.map(course => {
                const since = daysSince(course.endDate);
                const isUrgent = since >= 14;
                const isWarning = since >= 7 && since < 14;
                const borderColor = isUrgent ? 'border-l-red-400' : isWarning ? 'border-l-orange-400' : 'border-l-amber-400';
                const badgeBg = isUrgent ? 'bg-red-100 text-red-700' : isWarning ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700';

                return (
                  <div key={course.id} className={`bg-white rounded-xl border border-gray-200 border-l-4 ${borderColor} p-4 shadow-sm`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900 text-sm truncate">{course.name}</span>
                          <StatusBadge status={course.status} type="course" />
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badgeBg}`}>
                            {since === 0 ? '오늘 종료' : `${since}일 경과`}
                          </span>
                          <span className="text-xs text-gray-400">{formatDateOnly(course.endDate)} 종료</span>
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                          <span>계정 <strong className="text-gray-700">{course._count?.accounts ?? '-'}</strong>개</span>
                          {(course.totalCumulativeCost ?? 0) > 0 && (
                            <span className="text-blue-600 font-medium">누적 {formatCostExact(course.totalCumulativeCost!)}</span>
                          )}
                        </div>
                      </div>
                      <Link
                        to={`/courses/${course.id}`}
                        className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        상세 보기
                        <ArrowRightIcon className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 우측 패널 */}
        <div className="space-y-4">
          {/* 7일 내 종료 예정 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <ClockIcon className="h-5 w-5 text-amber-500" />
              <h2 className="text-sm font-semibold text-gray-900">7일 내 종료 예정</h2>
            </div>

            {endingSoon.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 py-8 text-center shadow-sm">
                <p className="text-sm text-gray-400">종료 임박한 과정이 없습니다.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {endingSoon.map(course => {
                  const days = daysUntil(course.endDate);
                  const dBadge = days <= 2 ? 'bg-red-100 text-red-700' : days <= 4 ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700';
                  return (
                    <Link
                      key={course.id}
                      to={`/courses/${course.id}`}
                      className="bg-white rounded-xl border border-gray-200 p-3.5 flex items-center justify-between gap-3 hover:shadow-md hover:border-gray-300 transition-all shadow-sm block"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 text-sm truncate">{course.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {formatDateOnly(course.endDate)} 종료 · 계정 {course._count?.accounts ?? '-'}개
                        </p>
                      </div>
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${dBadge}`}>
                        {days === 0 ? 'D-Day' : `D-${days}`}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* 전체 과정 현황 */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">전체 과정 현황</p>
            <div className="space-y-2">
              {courses
                .sort((a, b) => {
                  const order: Record<string, number> = { ACTIVE: 0, DRAFT: 1, COMPLETED: 2, ARCHIVED: 3 };
                  return (order[a.status] ?? 9) - (order[b.status] ?? 9);
                })
                .map(course => (
                  <Link
                    key={course.id}
                    to={`/courses/${course.id}`}
                    className="flex items-center justify-between gap-2 py-1.5 hover:bg-gray-50 rounded px-1 transition-colors"
                  >
                    <span className="text-xs text-gray-700 truncate flex-1">{course.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-gray-400">{course._count?.accounts ?? 0}개</span>
                      <StatusBadge status={course.status} type="course" />
                    </div>
                  </Link>
                ))
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
