import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExclamationTriangleIcon, PlayIcon, XMarkIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { cleanupApi, courseApi } from '../services/api';
import type { CleanupJob, Course } from '../types';
import LoadingSpinner from '../components/LoadingSpinner';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import { useAuth } from '../hooks/useAuth';
import { formatDateOnly, formatDate } from '../utils/format';

export default function CleanupPage() {
  const [jobs, setJobs] = useState<CleanupJob[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const { user } = useAuth();

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [jobsRes, coursesRes] = await Promise.all([
        cleanupApi.listJobs(),
        courseApi.list({ status: 'COMPLETED' })
      ]);

      if (jobsRes.success) setJobs(jobsRes.data || []);
      if (coursesRes.success) setCourses(coursesRes.data || []);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      await cleanupApi.cancelJob(jobId);
      toast.success('정리 작업이 취소되었습니다');
      loadData();
    } catch (error) {
      toast.error('작업 취소에 실패했습니다');
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">정리 작업</h1>
      </div>

      {/* Completed Courses */}
      {courses.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">완료된 과정</h2>
          <p className="text-sm text-gray-500 mb-4">
            아래 과정들의 리소스를 정리할 수 있습니다.
          </p>
          <div className="space-y-2">
            {courses.map((course) => (
              <div
                key={course.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
              >
                <div>
                  <Link
                    to={`/courses/${course.id}`}
                    className="font-medium text-gray-900 hover:text-ncp-primary"
                  >
                    {course.name}
                  </Link>
                  <p className="text-sm text-gray-500">
                    종료: {formatDateOnly(course.endDate)}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSelectedCourseId(course.id);
                    setIsPreviewModalOpen(true);
                  }}
                  className="btn-secondary text-sm"
                >
                  정리 미리보기
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cleanup Jobs */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">정리 작업 목록</h2>
        {jobs.length === 0 ? (
          <p className="text-gray-500 text-center py-8">등록된 정리 작업이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">과정</th>
                  <th className="text-center py-3 px-4 text-sm font-medium text-gray-500">상태</th>
                  <th className="text-center py-3 px-4 text-sm font-medium text-gray-500">모드</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">생성일</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-500">작업</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <Link
                        to={`/courses/${job.courseId}`}
                        className="font-medium text-gray-900 hover:text-ncp-primary"
                      >
                        {job.course?.name || job.courseId}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <StatusBadge status={job.status} type="cleanup" />
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`text-xs font-medium ${job.isDryRun ? 'text-blue-600' : 'text-red-600'}`}>
                        {job.isDryRun ? 'Dry-run' : '실제 삭제'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-500">
                      {formatDate(job.createdAt)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {job.status === 'PENDING' && (
                        <div className="flex justify-end gap-2">
                          {isSuperAdmin && !job.isDryRun && (
                            <button
                              onClick={() => executeJob(job.id)}
                              className="p-1 text-green-600 hover:text-green-800 rounded"
                              title="실행"
                            >
                              <PlayIcon className="h-5 w-5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleCancelJob(job.id)}
                            className="p-1 text-gray-400 hover:text-red-600 rounded"
                            title="취소"
                          >
                            <XMarkIcon className="h-5 w-5" />
                          </button>
                        </div>
                      )}
                      {job.status === 'COMPLETED' && job.summary && (
                        <span className="text-xs text-gray-500">
                          {job.summary.successActions}/{job.summary.totalActions} 성공
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      <CleanupPreviewModal
        isOpen={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
        courseId={selectedCourseId}
        onJobCreated={() => {
          setIsPreviewModalOpen(false);
          loadData();
        }}
      />
    </div>
  );

  async function executeJob(jobId: string) {
    if (!confirm('정말로 실행하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
      return;
    }

    try {
      await cleanupApi.executeJob(jobId);
      toast.success('정리 작업이 실행되었습니다');
      loadData();
    } catch (error) {
      toast.error('작업 실행에 실패했습니다');
    }
  }
}

function CleanupPreviewModal({
  isOpen,
  onClose,
  courseId,
  onJobCreated
}: {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
  onJobCreated: () => void;
}) {
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const { user } = useAuth();

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (isOpen && courseId) {
      loadPreview();
    }
  }, [isOpen, courseId]);

  const loadPreview = async () => {
    setIsLoading(true);
    try {
      const response = await cleanupApi.preview(courseId);
      if (response.success && response.data) {
        setPreview(response.data as Record<string, unknown>);
      }
    } catch (error) {
      toast.error('미리보기를 불러오는데 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateJob = async (isDryRun: boolean) => {
    setIsCreating(true);
    try {
      await cleanupApi.createJob(courseId, isDryRun);
      toast.success(`정리 작업이 생성되었습니다 (${isDryRun ? 'Dry-run' : '실제 삭제'})`);
      onJobCreated();
    } catch (error) {
      toast.error('작업 생성에 실패했습니다');
    } finally {
      setIsCreating(false);
    }
  };

  const totals = preview?.totals as Record<string, number> | undefined;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="정리 미리보기" size="lg">
      {isLoading ? (
        <LoadingSpinner />
      ) : preview ? (
        <div className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start">
              <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600 mr-2 mt-0.5" />
              <div>
                <p className="font-medium text-yellow-800">주의</p>
                <p className="text-sm text-yellow-700">
                  {preview.warning as string}
                </p>
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-medium text-gray-900 mb-2">삭제 예정 리소스</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {totals && Object.entries(totals).map(([type, count]) => (
                <div key={type} className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-red-600">{count}</p>
                  <p className="text-xs text-gray-500 capitalize">{type}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button className="btn-secondary" onClick={onClose}>
              취소
            </button>
            <button
              className="btn-secondary"
              onClick={() => handleCreateJob(true)}
              disabled={isCreating}
            >
              Dry-run 작업 생성
            </button>
            {isSuperAdmin && (
              <button
                className="btn-danger"
                onClick={() => handleCreateJob(false)}
                disabled={isCreating}
              >
                실제 삭제 작업 생성
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-gray-500 text-center py-4">미리보기를 불러올 수 없습니다.</p>
      )}
    </Modal>
  );
}
