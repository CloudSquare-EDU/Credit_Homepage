import { useState } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { accountApi } from '../../services/api';
import type { NcpAccount } from '../../types';
import Modal from '../Modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  accounts: NcpAccount[];
  courseId: string;
  onSuccess: () => void;
}

export default function BulkDeleteModal({ isOpen, onClose, accounts, onSuccess }: Props) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });
  const [isDryRun, setIsDryRun] = useState(true);
  const [deleteResults, setDeleteResults] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());

  const accountsWithSubAccounts = accounts.filter(acc => (acc._count?.subAccounts || 0) > 0);
  const isAllSelected = selectedAccountIds.size === accountsWithSubAccounts.length && accountsWithSubAccounts.length > 0;

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedAccountIds(new Set());
    } else {
      setSelectedAccountIds(new Set(accountsWithSubAccounts.map(acc => acc.id)));
    }
  };

  const toggleAccount = (accountId: string) => {
    const newSet = new Set(selectedAccountIds);
    if (newSet.has(accountId)) newSet.delete(accountId);
    else newSet.add(accountId);
    setSelectedAccountIds(newSet);
  };

  const selectedAccounts = accountsWithSubAccounts.filter(acc => selectedAccountIds.has(acc.id));
  const totalSubAccounts = selectedAccounts.reduce((sum, acc) => sum + (acc._count?.subAccounts || 0), 0);

  const handleDelete = async () => {
    if (selectedAccounts.length === 0) {
      toast.error('삭제할 계정을 선택해주세요');
      return;
    }
    if (!isDryRun && !confirm(`선택한 ${selectedAccounts.length}개 계정의 서브계정(총 ${totalSubAccounts}개)을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }

    setIsDeleting(true);
    setDeleteProgress({ current: 0, total: selectedAccounts.length });

    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < selectedAccounts.length; i++) {
      const account = selectedAccounts[i];
      try {
        const subAccResponse = await accountApi.getSubAccounts(account.id);
        const subAccounts = (subAccResponse.data?.accounts || []) as { subAccountId: string; subAccountName?: string }[];
        if (!isDryRun) {
          for (const subAcc of subAccounts) {
            try {
              await accountApi.deleteSubAccount(account.id, subAcc.subAccountId);
            } catch {
              errors.push(`${account.displayName} - ${subAcc.subAccountName || subAcc.subAccountId}: 삭제 실패`);
              failedCount++;
            }
          }
        }
        successCount++;
      } catch {
        failedCount++;
        errors.push(`${account.displayName}: 조회 실패`);
      }
      setDeleteProgress({ current: i + 1, total: accountsWithSubAccounts.length });
    }

    setIsDeleting(false);
    setDeleteResults({ success: successCount, failed: failedCount, errors });

    if (isDryRun) {
      toast.success(`Dry-run 완료: ${totalSubAccounts}개 서브계정이 삭제 대상입니다`);
    } else {
      if (failedCount === 0) {
        toast.success('모든 서브계정이 삭제되었습니다');
        onSuccess();
      } else {
        toast.error(`${failedCount}개 계정에서 오류 발생`);
      }
    }
  };

  const handleClose = () => {
    setDeleteResults(null);
    setIsDryRun(true);
    setSelectedAccountIds(new Set());
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="서브계정 일괄 삭제" size="md">
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start">
            <ExclamationTriangleIcon className="h-5 w-5 text-red-600 mr-2 mt-0.5" />
            <div>
              <p className="font-medium text-red-800">주의: 위험한 작업입니다</p>
              <p className="text-sm text-red-700 mt-1">
                선택한 계정의 모든 서브계정을 NCP에서 완전히 삭제합니다. 삭제된 서브계정은 복구할 수 없습니다.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-gray-900">{accountsWithSubAccounts.length}</p>
              <p className="text-sm text-gray-500">전체 계정</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-600">{selectedAccounts.length}</p>
              <p className="text-sm text-gray-500">선택된 계정</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600">{totalSubAccounts}</p>
              <p className="text-sm text-gray-500">삭제 대상 서브계정</p>
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
            <span className="text-xs text-gray-500">{selectedAccountIds.size}/{accountsWithSubAccounts.length}개 선택됨</span>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {accountsWithSubAccounts.map((account) => (
              <label key={account.id} className="flex items-center justify-between p-3 hover:bg-gray-50 cursor-pointer border-b last:border-b-0">
                <div className="flex items-center flex-1">
                  <input
                    type="checkbox"
                    checked={selectedAccountIds.has(account.id)}
                    onChange={() => toggleAccount(account.id)}
                    className="h-4 w-4 text-ncp-primary focus:ring-ncp-primary border-gray-300 rounded"
                  />
                  <span className="ml-3 text-sm text-gray-900">
                    {account.displayName || account.accessKeyHash?.substring(0, 12)}
                  </span>
                </div>
                <span className="text-xs text-gray-500">서브계정 {account._count?.subAccounts || 0}개</span>
              </label>
            ))}
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
              <span>진행 중...</span>
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
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-sm">
              처리 완료: <span className="text-green-600 font-medium">{deleteResults.success}개 성공</span>
              {deleteResults.failed > 0 && (
                <span className="text-red-600 font-medium ml-2">{deleteResults.failed}개 실패</span>
              )}
            </p>
            {deleteResults.errors.length > 0 && (
              <div className="mt-2 text-xs text-red-600 max-h-24 overflow-y-auto">
                {deleteResults.errors.map((err, i) => <p key={i}>{err}</p>)}
              </div>
            )}
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
              ? `처리 중... ${deleteProgress.current}/${deleteProgress.total}`
              : isDryRun
                ? 'Dry-run 실행'
                : `${selectedAccounts.length}개 계정 서브계정 삭제`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
