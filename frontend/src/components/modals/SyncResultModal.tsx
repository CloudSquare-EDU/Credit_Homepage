import { CheckIcon, ChevronDownIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import type { SyncResult } from '../../types';
import Modal from '../Modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  results: SyncResult[];
}

export default function SyncResultModal({ isOpen, onClose, results }: Props) {
  const successResults = results.filter(r => r.success);
  const failedResults = results.filter(r => !r.success);
  const totalSubAccounts = successResults.reduce((sum, r) => sum + (r.subAccountCount || 0), 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="동기화 결과" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-green-50 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{successResults.length}</p>
            <p className="text-sm text-green-700">성공</p>
          </div>
          <div className="bg-red-50 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{failedResults.length}</p>
            <p className="text-sm text-red-700">실패</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{totalSubAccounts}</p>
            <p className="text-sm text-blue-700">총 서브계정</p>
          </div>
        </div>

        {failedResults.length > 0 && (
          <div>
            <h3 className="font-medium text-red-700 mb-2 flex items-center gap-2">
              <ExclamationTriangleIcon className="h-5 w-5" />
              실패한 계정 ({failedResults.length}개)
            </h3>
            <div className="bg-red-50 rounded-lg p-3 max-h-48 overflow-y-auto">
              <ul className="space-y-2">
                {failedResults.map((result) => (
                  <li key={result.accountId} className="text-sm">
                    <span className="font-medium text-gray-900">{result.accountName}</span>
                    <span className="text-red-600 ml-2">- {result.error}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {successResults.length > 0 && (
          <details className="group">
            <summary className="font-medium text-green-700 mb-2 cursor-pointer list-none flex items-center gap-2">
              <CheckIcon className="h-5 w-5" />
              성공한 계정 ({successResults.length}개)
              <ChevronDownIcon className="h-4 w-4 group-open:rotate-180 transition-transform" />
            </summary>
            <div className="bg-green-50 rounded-lg p-3 max-h-48 overflow-y-auto">
              <ul className="space-y-1">
                {successResults.map((result) => (
                  <li key={result.accountId} className="text-sm flex justify-between">
                    <span className="text-gray-900">{result.accountName}</span>
                    <span className="text-green-600">서브계정 {result.subAccountCount}개</span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        )}

        <div className="flex justify-end pt-4 border-t">
          <button className="btn-primary" onClick={onClose}>확인</button>
        </div>
      </div>
    </Modal>
  );
}
