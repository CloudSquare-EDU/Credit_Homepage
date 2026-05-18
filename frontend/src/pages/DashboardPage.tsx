import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  ClockIcon,
  AcademicCapIcon,
  FlagIcon,
} from '@heroicons/react/24/outline';
import { courseApi } from '../services/api';
import type { Course } from '../types';
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

  useEffect(() => {
    courseApi.list().then(res => {
      if (res.success && res.data) setCourses(res.data);
    }).catch(() => {}).finally(() => setIsLoading(false));
  }, []);

  const completedWithAccounts = useMemo(() =>
    courses
      .filter(c => (c.status === 'COMPLETED' || c.status === 'ARCHIVED') && (c._count?.accounts || 0) > 0)
      .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime()),
    [courses]
  );

  const endingSoon = useMemo(() =>
    courses
      .filter(c => c.status === 'ACTIVE' && daysUntil(c.endDate) <= 7 && daysUntil(c.endDate) >= 0)
      .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime()),
    [courses]
  );

  const totalCompletedAccounts = completedWithAccounts.reduce((s, c) => s + (c._count?.accounts || 0), 0);
  const activeCourses = courses.filter(c => c.status === 'ACTIVE');
  const cleanedCourses = courses.filter(c => c.status === 'COMPLETED' && (c._count?.accounts || 0) === 0);
  const needsCleanup = completedWithAccounts.length > 0;

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">대시보드</h1>
        <p className="text-sm text-gray-500 mt-0.5">NCP 교육 계정 운영 현황</p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-4">
        {/* 진행 중인 과정 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">진행 중인 과정</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {activeCourses.length}
              <span className="text-base font-normal text-gray-400 ml-1">개</span>
            </p>
            {endingSoon.length > 0 ? (
              <p className="text-xs text-amber-600 mt-2 flex items-center gap-1 font-medium">
                <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                {endingSoon.length}개 7일 내 종료
              </p>
            ) : (
              <p className="text-xs text-gray-400 mt-2">종료 임박 없음</p>
            )}
          </div>
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <AcademicCapIcon className="h-5 w-5 text-blue-500" />
          </div>
        </div>

        {/* 정리 필요 과정 */}
        <div className={`rounded-xl border p-5 shadow-sm flex items-start justify-between ${needsCleanup ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
          <div>
            <p className={`text-xs font-medium uppercase tracking-wide ${needsCleanup ? 'text-red-500' : 'text-green-600'}`}>정리 필요 과정</p>
            <p className={`text-3xl font-bold mt-1 ${needsCleanup ? 'text-red-600' : 'text-green-600'}`}>
              {completedWithAccounts.length}
              <span className="text-base font-normal text-gray-400 ml-1">개</span>
            </p>
            {needsCleanup ? (
              <p className="text-xs text-red-500 mt-2 font-medium">계정 {totalCompletedAccounts}개 잔여</p>
            ) : (
              <p className="text-xs text-green-600 mt-2 flex items-center gap-1 font-medium">
                <CheckCircleIcon className="h-3.5 w-3.5" />모두 정리 완료
              </p>
            )}
          </div>
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${needsCleanup ? 'bg-red-100' : 'bg-green-100'}`}>
            {needsCleanup
              ? <ExclamationTriangleIcon className="h-5 w-5 text-red-500" />
              : <CheckCircleIcon className="h-5 w-5 text-green-500" />
            }
          </div>
        </div>

        {/* 전체 과정 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">전체 과정</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {courses.length}
              <span className="text-base font-normal text-gray-400 ml-1">개</span>
            </p>
            <p className="text-xs text-gray-400 mt-2">
              완료 {courses.filter(c => c.status === 'COMPLETED' || c.status === 'ARCHIVED').length}개
            </p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
            <FlagIcon className="h-5 w-5 text-gray-400" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 정리 필요 과정 목록 */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center gap-2">
            <ExclamationTriangleIcon className="h-4.5 w-4.5 text-red-500 h-5 w-5" />
            <h2 className="text-sm font-semibold text-gray-900">종료 과정 — 정리 필요</h2>
            <span className="text-xs text-gray-400 ml-1">(계정이 남아있는 완료/보관 과정)</span>
          </div>

          {completedWithAccounts.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center py-12 text-center shadow-sm">
              <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mb-3">
                <CheckCircleIcon className="h-7 w-7 text-green-400" />
              </div>
              <p className="font-medium text-gray-700">정리가 필요한 과정이 없습니다</p>
              <p className="text-sm text-gray-400 mt-1">종료된 과정의 계정 및 리소스가 모두 정리되었습니다.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {completedWithAccounts.map(course => {
                const since = daysSince(course.endDate);
                const isUrgent = since >= 14;
                const isWarning = since >= 7 && since < 14;

                const borderColor = isUrgent ? 'border-l-red-400' : isWarning ? 'border-l-orange-400' : 'border-l-amber-400';
                const badgeBg = isUrgent ? 'bg-red-100 text-red-700' : isWarning ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700';
                const sinceText = since === 0 ? '오늘 종료' : `${since}일 경과`;

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
                            {sinceText}
                          </span>
                          <span className="text-xs text-gray-400">{formatDateOnly(course.endDate)} 종료</span>
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                          <span>계정 <strong className="text-gray-700">{course._count?.accounts ?? '-'}</strong>개</span>
                          {(course.totalCumulativeCost ?? 0) > 0 && (
                            <span className="text-blue-600 font-medium">
                              누적 {formatCostExact(course.totalCumulativeCost!)}
                            </span>
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
          {/* 종료 임박 */}
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
                        <p className="text-xs text-gray-400 mt-0.5">{formatDateOnly(course.endDate)} 종료 · 계정 {course._count?.accounts ?? '-'}개</p>
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

          {/* 최근 정리 완료 */}
          {cleanedCourses.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">최근 정리 완료</p>
              <div className="space-y-2">
                {cleanedCourses.slice(0, 4).map(course => (
                  <div key={course.id} className="flex items-center gap-2">
                    <CheckCircleIcon className="h-4 w-4 text-green-400 shrink-0" />
                    <span className="text-xs text-gray-500 truncate">{course.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
