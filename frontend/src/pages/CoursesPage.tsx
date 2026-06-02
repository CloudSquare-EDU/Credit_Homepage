import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PlusIcon,
  MagnifyingGlassIcon,
  PencilIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  CalendarDaysIcon,
  UserGroupIcon,
  BanknotesIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { courseApi, monitoringApi } from '../services/api';
import type { Course, CreditInfo } from '../types';
import LoadingSpinner from '../components/LoadingSpinner';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import { useAuth } from '../hooks/useAuth';
import { formatDateOnly, formatCostExact } from '../utils/format';

const STATUS_TABS = [
  { value: '',          label: '전체' },
  { value: 'ACTIVE',    label: '진행중' },
  { value: 'DRAFT',     label: '초안' },
  { value: 'COMPLETED', label: '완료' },
  { value: 'ARCHIVED',  label: '보관' },
] as const;

const STATUS_ACCENT: Record<string, string> = {
  ACTIVE:    'border-l-blue-500',
  DRAFT:     'border-l-gray-300',
  COMPLETED: 'border-l-emerald-400',
  ARCHIVED:  'border-l-amber-400',
};

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null);
  const [creditMap, setCreditMap] = useState<Record<string, CreditInfo>>({});
  const { user } = useAuth();

  const canEdit = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const canDelete = user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    loadCourses();
  }, [statusFilter]);

  useEffect(() => {
    monitoringApi.getCredits().then(res => {
      if (res.success && res.data) {
        const map: Record<string, CreditInfo> = {};
        for (const acc of res.data.accounts) {
          if (acc.success) map[acc.courseId] = acc;
        }
        setCreditMap(map);
      }
    }).catch(() => {});
  }, []);

  const loadCourses = async () => {
    try {
      const response = await courseApi.list({ status: statusFilter || undefined });
      if (response.success && response.data) {
        setCourses(response.data);
      }
    } catch (error) {
      toast.error('과정 목록을 불러오는데 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteCourse = async () => {
    if (!deletingCourse) return;
    try {
      await courseApi.delete(deletingCourse.id);
      toast.success('과정이 삭제되었습니다');
      setDeletingCourse(null);
      loadCourses();
    } catch (error) {
      toast.error('과정 삭제에 실패했습니다. 연결된 계정이 있을 수 있습니다.');
    }
  };

  const filteredCourses = courses.filter(course =>
    course.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    course.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="page-title">과정 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            총 {courses.length}개 과정
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="btn-primary"
          >
            <PlusIcon className="h-4 w-4" />
            과정 추가
          </button>
        )}
      </div>

      {/* Status tabs + search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Status tabs */}
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 overflow-x-auto flex-shrink-0">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-all ${
                statusFilter === tab.value
                  ? 'bg-ncp-primary text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {tab.label}
              {tab.value === '' && (
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                  statusFilter === '' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
                }`}>
                  {courses.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            className="input pl-9 text-sm"
            placeholder="과정 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Course Grid */}
      {filteredCourses.length === 0 ? (
        <div className="card text-center py-16">
          <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AcademicCapIconFallback />
          </div>
          <p className="font-medium text-gray-700 mb-1">
            {searchQuery ? `"${searchQuery}" 검색 결과가 없습니다` : '등록된 과정이 없습니다'}
          </p>
          {!searchQuery && canEdit && (
            <p className="text-sm text-gray-400">
              우측 상단 "과정 추가"를 눌러 첫 과정을 만들어 보세요.
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredCourses.map((course) => {
            const totalCumulativeCost = course.totalCumulativeCost ?? null;
            const hasCost = totalCumulativeCost != null;
            const hasBudget = course.budgetAmount != null && course.budgetRatio != null;
            const allocatedAmount = hasBudget
              ? Math.round(course.budgetAmount! * course.budgetRatio! / 100)
              : null;
            const remaining = allocatedAmount != null && hasCost
              ? allocatedAmount - totalCumulativeCost!
              : null;
            const isOverBudget = remaining != null && remaining < 0;

            const creditInfo = creditMap[course.id] ?? null;
            const creditItem = creditInfo?.credits?.[0] ?? null;
            const isCoin = creditItem?.coinType === 'COIN';
            const creditLabel = isCoin ? '코인' : '크레딧';
            const usedPct = creditItem && creditItem.totalCoin > 0
              ? Math.min(100, (creditItem.usedCoin / creditItem.totalCoin) * 100)
              : null;
            const creditWarn = usedPct != null && usedPct >= 80;

            return (
              <div
                key={course.id}
                className={`relative group bg-white rounded-xl border border-gray-100 shadow-card
                  hover:shadow-card-hover hover:border-ncp-border transition-all duration-200
                  border-l-4 ${STATUS_ACCENT[course.status] || 'border-l-gray-200'}
                  ${isOverBudget ? 'ring-1 ring-red-200' : ''}`}
              >
                {/* Action buttons */}
                {canEdit && (
                  <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <button
                      onClick={(e) => { e.preventDefault(); setEditingCourse(course); }}
                      className="p-1.5 bg-white rounded-lg shadow-sm border border-gray-100 hover:border-ncp-border text-gray-400 hover:text-ncp-primary transition-colors"
                      title="수정"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                    </button>
                    {canDelete && (
                      <button
                        onClick={(e) => { e.preventDefault(); setDeletingCourse(course); }}
                        className="p-1.5 bg-white rounded-lg shadow-sm border border-gray-100 hover:border-red-200 text-gray-400 hover:text-red-500 transition-colors"
                        title="삭제"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}

                <Link to={`/courses/${course.id}`} className="block p-5">
                  {/* Title + badge */}
                  <div className="flex items-start justify-between gap-2 mb-2 pr-14">
                    <h3 className="font-semibold text-gray-900 leading-snug line-clamp-2">
                      {course.name}
                    </h3>
                    <StatusBadge status={course.status} type="course" />
                  </div>

                  {course.description && (
                    <p className="text-xs text-gray-400 line-clamp-1 mb-3">{course.description}</p>
                  )}

                  {/* Meta info */}
                  <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
                    <span className="flex items-center gap-1">
                      <CalendarDaysIcon className="h-3.5 w-3.5" />
                      {formatDateOnly(course.startDate)} ~{' '}
                      {formatDateOnly(course.endDate)}
                    </span>
                    <span className="flex items-center gap-1 font-medium text-ncp-primary">
                      <UserGroupIcon className="h-3.5 w-3.5" />
                      {course._count?.accounts || 0}명
                    </span>
                  </div>

                  {/* Budget / cost block — 모든 과정에 표시 */}
                  <div className="border-t border-gray-50 pt-3 mt-3 space-y-1.5">
                    {hasBudget && (
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-gray-400 flex items-center gap-1">
                          <BanknotesIcon className="h-3.5 w-3.5" />
                          할당예산
                        </span>
                        <span className="font-medium text-gray-600">
                          {formatCostExact(allocatedAmount!)}
                          <span className="text-gray-400 ml-1">VAT별도</span>
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-500 font-medium">전체 사용료</span>
                      {hasCost ? (
                        <span className="font-bold text-blue-600">
                          {totalCumulativeCost! > 0 ? formatCostExact(totalCumulativeCost!) : '0원'}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-[11px]">업데이트 대기 중</span>
                      )}
                    </div>
                    {remaining != null && (
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-gray-400">잔여예산</span>
                        <span className={`font-semibold ${remaining >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {formatCostExact(remaining)}
                        </span>
                      </div>
                    )}
                    {isOverBudget && (
                      <div className="flex items-center gap-1 mt-1.5 px-2 py-1 bg-red-50 border border-red-100 rounded-md text-xs text-red-600">
                        <ExclamationTriangleIcon className="h-3.5 w-3.5 flex-shrink-0" />
                        예산 초과 {formatCostExact(Math.abs(remaining!))}
                      </div>
                    )}
                  </div>

                  {/* 크레딧/코인 현황 */}
                  {creditItem && (
                    <div className={`border-t border-gray-50 pt-3 mt-2 space-y-1.5 ${creditWarn ? 'border-t-amber-100' : ''}`}>
                      <div className="flex justify-between items-center text-xs">
                        <span className={`font-medium flex items-center gap-1 ${creditWarn ? 'text-amber-600' : 'text-gray-500'}`}>
                          {creditWarn && <span className="text-amber-500">⚠</span>}
                          {creditLabel} 잔여
                        </span>
                        <span className={`font-bold ${creditWarn ? 'text-amber-600' : 'text-purple-600'}`}>
                          {formatCostExact(creditItem.remainCoin)}
                          {creditItem.totalCoin > 0 && (
                            <span className="font-normal text-gray-400 ml-1">/ {formatCostExact(creditItem.totalCoin)}</span>
                          )}
                        </span>
                      </div>
                      {usedPct != null && creditItem.totalCoin > 0 && (
                        <div className="w-full bg-gray-100 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full transition-all ${usedPct >= 90 ? 'bg-red-500' : usedPct >= 80 ? 'bg-amber-500' : 'bg-purple-500'}`}
                            style={{ width: `${usedPct.toFixed(1)}%` }}
                          />
                        </div>
                      )}
                      <div className="flex justify-between text-[10px] text-gray-400">
                        <span>{usedPct?.toFixed(1)}% 사용</span>
                        {creditItem.expireMonth && <span>~{creditItem.expireMonth}</span>}
                      </div>
                    </div>
                  )}

                  {/* Tags */}
                  {course.tags && course.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {course.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="px-2 py-0.5 bg-ncp-light text-ncp-primary text-xs rounded-full font-medium">
                          {tag}
                        </span>
                      ))}
                      {course.tags.length > 3 && (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-400 text-xs rounded-full">
                          +{course.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <CreateCourseModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => { setIsCreateModalOpen(false); loadCourses(); }}
      />

      {editingCourse && (
        <EditCourseModal
          isOpen={!!editingCourse}
          course={editingCourse}
          onClose={() => setEditingCourse(null)}
          onSuccess={() => { setEditingCourse(null); loadCourses(); }}
        />
      )}

      {deletingCourse && (
        <Modal isOpen={!!deletingCourse} onClose={() => setDeletingCourse(null)} title="과정 삭제" size="sm">
          <div className="space-y-4">
            <p className="text-gray-600 text-sm">
              <strong className="text-gray-900">"{deletingCourse.name}"</strong> 과정을 삭제하시겠습니까?
              이 작업은 되돌릴 수 없습니다.
            </p>
            {(deletingCourse._count?.accounts || 0) > 0 && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">
                <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0 mt-0.5" />
                이 과정에 {deletingCourse._count?.accounts}개의 계정이 연결되어 있습니다.
                계정을 먼저 삭제해야 합니다.
              </div>
            )}
            <div className="flex justify-end gap-3 pt-1">
              <button className="btn-secondary" onClick={() => setDeletingCourse(null)}>취소</button>
              <button className="btn-danger" onClick={handleDeleteCourse}>삭제</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AcademicCapIconFallback() {
  return (
    <svg className="h-7 w-7 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 3.741-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5" />
    </svg>
  );
}

function CourseFormFields({
  name, setName,
  description, setDescription,
  startDate, setStartDate,
  endDate, setEndDate,
  tags, setTags,
  budgetAmount, setBudgetAmount,
  budgetRatio, setBudgetRatio,
  allocatedPreview,
  showStatus = false,
  status, setStatus,
}: {
  name: string; setName: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  startDate: string; setStartDate: (v: string) => void;
  endDate: string; setEndDate: (v: string) => void;
  tags: string; setTags: (v: string) => void;
  budgetAmount: string; setBudgetAmount: (v: string) => void;
  budgetRatio: string; setBudgetRatio: (v: string) => void;
  allocatedPreview: number | null;
  showStatus?: boolean;
  status?: Course['status']; setStatus?: (v: Course['status']) => void;
}) {
  return (
    <>
      <div>
        <label className="label">과정명 *</label>
        <input type="text" className="input" value={name} onChange={e => setName(e.target.value)}
          placeholder="클라우드 기초 교육" required />
      </div>
      <div>
        <label className="label">설명</label>
        <textarea className="input" rows={2} value={description}
          onChange={e => setDescription(e.target.value)} placeholder="과정에 대한 설명" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">시작일 *</label>
          <input type="date" className="input" value={startDate}
            onChange={e => setStartDate(e.target.value)} required />
        </div>
        <div>
          <label className="label">종료일 *</label>
          <input type="date" className="input" value={endDate}
            onChange={e => setEndDate(e.target.value)} required />
        </div>
      </div>
      {showStatus && status !== undefined && setStatus && (
        <div>
          <label className="label">상태</label>
          <select className="input" value={status} onChange={e => setStatus(e.target.value as Course['status'])}>
            <option value="DRAFT">초안</option>
            <option value="ACTIVE">진행중</option>
            <option value="COMPLETED">완료</option>
            <option value="ARCHIVED">보관</option>
          </select>
        </div>
      )}
      <div>
        <label className="label">태그 (쉼표로 구분)</label>
        <input type="text" className="input" value={tags} onChange={e => setTags(e.target.value)}
          placeholder="교육, 기초, NCP" />
      </div>
      <div className="border-t pt-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">예산 설정 <span className="text-gray-400 font-normal">(VAT 별도, 선택)</span></p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">총 예산 (원)</label>
            <input type="number" className="input" value={budgetAmount}
              onChange={e => setBudgetAmount(e.target.value)} placeholder="65000000" min="0" />
          </div>
          <div>
            <label className="label">할당 비율 (%)</label>
            <input type="number" className="input" value={budgetRatio}
              onChange={e => setBudgetRatio(e.target.value)} placeholder="30" min="0" max="100" step="0.1" />
          </div>
        </div>
        {allocatedPreview != null && (
          <div className="mt-2 px-3 py-2 bg-ncp-light border border-ncp-border rounded-lg">
            <p className="text-sm text-ncp-primary font-medium">
              할당금액: <strong>{formatCostExact(allocatedPreview)}</strong>
              <span className="text-xs font-normal ml-1">(VAT 별도)</span>
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function CreateCourseModal({ isOpen, onClose, onSuccess }: { isOpen: boolean; onClose: () => void; onSuccess: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [tags, setTags] = useState('');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetRatio, setBudgetRatio] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const allocatedPreview = budgetAmount && budgetRatio
    ? Math.round(Number(budgetAmount) * Number(budgetRatio) / 100) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await courseApi.create({
        name, description, startDate, endDate,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        budgetAmount: budgetAmount ? Number(budgetAmount) : undefined,
        budgetRatio: budgetRatio ? Number(budgetRatio) : undefined,
      });
      toast.success('과정이 생성되었습니다');
      onSuccess();
      setName(''); setDescription(''); setStartDate(''); setEndDate('');
      setTags(''); setBudgetAmount(''); setBudgetRatio('');
    } catch (error) {
      toast.error('과정 생성에 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="새 과정 추가" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <CourseFormFields
          name={name} setName={setName}
          description={description} setDescription={setDescription}
          startDate={startDate} setStartDate={setStartDate}
          endDate={endDate} setEndDate={setEndDate}
          tags={tags} setTags={setTags}
          budgetAmount={budgetAmount} setBudgetAmount={setBudgetAmount}
          budgetRatio={budgetRatio} setBudgetRatio={setBudgetRatio}
          allocatedPreview={allocatedPreview}
        />
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn-primary" disabled={isLoading}>
            {isLoading ? '생성 중...' : '과정 생성'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditCourseModal({ isOpen, course, onClose, onSuccess }: {
  isOpen: boolean; course: Course; onClose: () => void; onSuccess: () => void;
}) {
  const [name, setName] = useState(course.name);
  const [description, setDescription] = useState(course.description || '');
  const [startDate, setStartDate] = useState(course.startDate.slice(0, 10));
  const [endDate, setEndDate] = useState(course.endDate.slice(0, 10));
  const [tags, setTags] = useState(course.tags?.join(', ') || '');
  const [status, setStatus] = useState(course.status);
  const [budgetAmount, setBudgetAmount] = useState(course.budgetAmount != null ? String(course.budgetAmount) : '');
  const [budgetRatio, setBudgetRatio] = useState(course.budgetRatio != null ? String(course.budgetRatio) : '');
  const [isLoading, setIsLoading] = useState(false);

  const allocatedPreview = budgetAmount && budgetRatio
    ? Math.round(Number(budgetAmount) * Number(budgetRatio) / 100) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await courseApi.update(course.id, {
        name, description, startDate, endDate,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        status,
        budgetAmount: budgetAmount ? Number(budgetAmount) : null,
        budgetRatio: budgetRatio ? Number(budgetRatio) : null,
      });
      toast.success('과정이 수정되었습니다');
      onSuccess();
    } catch (error) {
      toast.error('과정 수정에 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="과정 수정" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <CourseFormFields
          name={name} setName={setName}
          description={description} setDescription={setDescription}
          startDate={startDate} setStartDate={setStartDate}
          endDate={endDate} setEndDate={setEndDate}
          tags={tags} setTags={setTags}
          budgetAmount={budgetAmount} setBudgetAmount={setBudgetAmount}
          budgetRatio={budgetRatio} setBudgetRatio={setBudgetRatio}
          allocatedPreview={allocatedPreview}
          showStatus
          status={status} setStatus={setStatus}
        />
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn-primary" disabled={isLoading}>
            {isLoading ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
