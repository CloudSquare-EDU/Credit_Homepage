import { useState } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { courseApi } from '../../services/api';
import type { NcpAccount, AccountResourceData } from '../../types';
import Modal from '../Modal';

interface CleanupResult {
  success: boolean;
  results: Array<{
    accountId: string;
    accountName: string;
    success: boolean;
    actions: Array<{
      type: string;
      targetId: string;
      targetName?: string;
      status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'MANUAL_REQUIRED';
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
    manualRequiredActions: number;
  };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  accounts: NcpAccount[];
  courseId: string;
  accountResourceMap: Record<string, AccountResourceData>;
  onSuccess: () => void;
}

export default function BulkCleanupModal({ isOpen, onClose, accounts, courseId, accountResourceMap, onSuccess }: Props) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });
  const [isDryRun, setIsDryRun] = useState(true);
  const [deleteResults, setDeleteResults] = useState<CleanupResult | null>(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());

  const accountsWithResources = accounts.filter(acc => {
    const resourceData = accountResourceMap[acc.id];
    return resourceData && resourceData.totalResourceCount > 0;
  });

  const isAllSelected = selectedAccountIds.size === accountsWithResources.length && accountsWithResources.length > 0;

  const toggleSelectAll = () => {
    if (isAllSelected) setSelectedAccountIds(new Set());
    else setSelectedAccountIds(new Set(accountsWithResources.map(acc => acc.id)));
  };

  const toggleAccount = (accountId: string) => {
    const newSet = new Set(selectedAccountIds);
    if (newSet.has(accountId)) newSet.delete(accountId);
    else newSet.add(accountId);
    setSelectedAccountIds(newSet);
  };

  const selectedAccounts = accountsWithResources.filter(acc => selectedAccountIds.has(acc.id));
  const totalResources = selectedAccounts.reduce((sum, acc) => {
    const resourceData = accountResourceMap[acc.id];
    return sum + (resourceData?.totalResourceCount || 0);
  }, 0);

  const handleDelete = async () => {
    if (selectedAccounts.length === 0) {
      toast.error('삭제할 계정을 선택해주세요');
      return;
    }
    if (!isDryRun && !confirm(
      `선택한 ${selectedAccounts.length}개 계정의 모든 리소스를 삭제하시겠습니까?\n` +
      `(서버, 로드밸런서, NAT Gateway, 서브계정 포함)\n\n이 작업은 되돌릴 수 없습니다.`
    )) return;

    setIsDeleting(true);
    setDeleteProgress({ current: 0, total: selectedAccounts.length });

    try {
      const response = await courseApi.cleanupResources(
        courseId,
        selectedAccounts.map(acc => acc.id),
        isDryRun
      );

      if (response.success && response.data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setDeleteResults({ success: true, ...(response.data as any) });
        if (isDryRun) {
          toast.success(`Dry-run 완료: ${response.data.summary.skippedActions}개 작업이 삭제 대상입니다`);
        } else {
          if (response.data.summary.failedActions === 0) {
            toast.success('모든 리소스가 삭제되었습니다');
            onSuccess();
          } else {
            toast.error(`${response.data.summary.failedActions}개 작업 실패`);
          }
        }
      }
    } catch (error) {
      console.error('Cleanup failed:', error);
      toast.error('리소스 삭제에 실패했습니다');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClose = () => {
    setDeleteResults(null);
    setIsDryRun(true);
    setSelectedAccountIds(new Set());
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="리소스 일괄 삭제" size="lg">
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start">
            <ExclamationTriangleIcon className="h-5 w-5 text-red-600 mr-2 mt-0.5" />
            <div>
              <p className="font-medium text-red-800">주의: 매우 위험한 작업입니다</p>
              <p className="text-sm text-red-700 mt-1">
                선택한 계정의 모든 리소스를 NCP에서 완전히 삭제합니다.
                (서버, 로드밸런서, NAT Gateway, 서브계정 포함) 삭제된 리소스는 복구할 수 없습니다.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-gray-900">{accountsWithResources.length}</p>
              <p className="text-sm text-gray-500">리소스 보유 계정</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-600">{selectedAccounts.length}</p>
              <p className="text-sm text-gray-500">선택된 계정</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600">{totalResources}</p>
              <p className="text-sm text-gray-500">삭제 대상 리소스</p>
            </div>
          </div>
        </div>

        <div className="border rounded-lg">
          <div className="flex items-center justify-between p-3 bg-gray-50 border-b">
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={toggleSelectAll}
                className="h-4 w-4 text-ncp-primary focus:ring-ncp-primary border-gray-300 rounded"
              />
              <span className="ml-2 text-sm font-medium text-gray-700">전체 선택</span>
            </label>
            <span className="text-xs text-gray-500">{selectedAccountIds.size}/{accountsWithResources.length}개 선택됨</span>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {accountsWithResources.map((account) => {
              const resourceData = accountResourceMap[account.id];
              return (
                <label key={account.id} className="flex items-center justify-between p-3 hover:bg-gray-50 cursor-pointer border-b last:border-b-0">
                  <div className="flex items-center flex-1">
                    <input
                      type="checkbox"
                      checked={selectedAccountIds.has(account.id)}
                      onChange={() => toggleAccount(account.id)}
                      className="h-4 w-4 text-ncp-primary focus:ring-ncp-primary border-gray-300 rounded"
                    />
                    <div className="ml-3">
                      <p className="text-sm text-gray-900">
                        {account.displayName || account.accessKeyHash?.substring(0, 12)}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {Object.entries(resourceData.resources).map(([type, count]) => (
                          <span key={type} className="px-1.5 py-0.5 bg-red-50 text-red-700 text-xs rounded">
                            {type}: {count}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-gray-500 ml-2">총 {resourceData.totalResourceCount}개</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
          <div>
            <p className="font-medium text-gray-900">Dry-run 모드</p>
            <p className="text-xs text-gray-500">실제로 삭제하지 않고 시뮬레이션만 합니다</p>
          </div>
          <button
            onClick={() => setIsDryRun(!isDryRun)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isDryRun ? 'bg-blue-600' : 'bg-red-600'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isDryRun ? 'translate-x-1' : 'translate-x-6'}`} />
          </button>
        </div>

        {isDeleting && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>처리 중...</span>
              <span>{deleteProgress.current}/{deleteProgress.total}</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-ncp-primary transition-all"
                style={{ width: `${(deleteProgress.current / deleteProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {deleteResults && (
          <div className="p-4 bg-gray-50 rounded-lg max-h-48 overflow-y-auto">
            <div className="text-sm mb-2">
              <span className="font-medium">처리 완료: </span>
              <span className="text-green-600">{deleteResults.summary.successActions}개 성공</span>
              {deleteResults.summary.failedActions > 0 && (
                <span className="text-red-600 ml-2">{deleteResults.summary.failedActions}개 실패</span>
              )}
              {deleteResults.summary.skippedActions > 0 && (
                <span className="text-gray-600 ml-2">{deleteResults.summary.skippedActions}개 대기</span>
              )}
              {deleteResults.summary.manualRequiredActions > 0 && (
                <span className="text-yellow-600 ml-2">{deleteResults.summary.manualRequiredActions}개 수동 삭제 필요</span>
              )}
            </div>
            {deleteResults.summary.manualRequiredActions > 0 && (
              <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
                <p className="font-medium mb-1">수동 삭제가 필요한 항목이 있습니다</p>
                <ul className="list-disc list-inside text-xs space-y-0.5 text-yellow-700">
                  <li>VPC Peering, 서버 이미지(스냅샷) 등 일부 리소스는 API로 자동 삭제가 불가능합니다.</li>
                  <li>NCP 콘솔(console.ncloud.com) → 해당 계정으로 로그인 후 직접 삭제해주세요.</li>
                  <li>삭제 후 다시 동기화하면 목록에서 제거됩니다.</li>
                </ul>
              </div>
            )}
            {deleteResults.results
              .filter(r => !r.success || r.actions.some(a => a.status === 'FAILED' || a.status === 'MANUAL_REQUIRED'))
              .map((result) => (
                <details key={result.accountId} className="mb-2">
                  <summary className="cursor-pointer text-sm font-medium text-gray-700">
                    {result.accountName} ({result.actions.length}개 작업)
                  </summary>
                  <div className="ml-4 mt-1 text-xs text-gray-600">
                    {result.actions.map((action, idx) => (
                      <p key={idx} className={
                        action.status === 'FAILED' ? 'text-red-600' :
                        action.status === 'MANUAL_REQUIRED' ? 'text-yellow-600' : ''
                      }>
                        {action.type}: {action.targetName || action.targetId} - {action.status}
                        {action.status === 'MANUAL_REQUIRED' && ' (NCP 콘솔에서 직접 삭제 필요)'}
                        {action.error && ` (${action.error})`}
                      </p>
                    ))}
                  </div>
                </details>
              ))}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button className="btn-secondary" onClick={handleClose}>취소</button>
          <button
            className={isDryRun ? 'btn-primary' : 'btn-danger'}
            onClick={handleDelete}
            disabled={isDeleting || selectedAccounts.length === 0}
          >
            {isDeleting
              ? '처리 중...'
              : isDryRun
                ? 'Dry-run 실행'
                : `${selectedAccounts.length}개 계정 리소스 삭제`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
