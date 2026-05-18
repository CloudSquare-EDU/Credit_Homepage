import { useState } from 'react';
import toast from 'react-hot-toast';
import { accountApi } from '../../services/api';
import Modal from '../Modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
  accountCount: number;
  onSuccess: () => void;
}

export default function BulkRenameModal({ isOpen, onClose, courseId, accountCount, onSuccess }: Props) {
  const [prefix, setPrefix] = useState('교육계정_cs');
  const [startNumber, setStartNumber] = useState('1');
  const [isLoading, setIsLoading] = useState(false);

  const start = parseInt(startNumber) || 1;
  const previewFirst = `${prefix}${String(start).padStart(3, '0')}`;
  const previewSecond = `${prefix}${String(start + 1).padStart(3, '0')}`;
  const previewLast = `${prefix}${String(start + accountCount - 1).padStart(3, '0')}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const response = await accountApi.bulkRename(courseId, prefix, start);
      if (response.success && response.data) {
        toast.success(`${response.data.renamed}개 계정 이름이 변경되었습니다`);
        onSuccess();
      }
    } catch {
      toast.error('일괄 이름 변경에 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="계정 이름 일괄 변경" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-500">
          총 <strong>{accountCount}개</strong> 계정의 이름을 한 번에 변경합니다. (등록 순서 기준)
        </p>
        <div>
          <label className="label">이름 접두어</label>
          <input
            type="text"
            className="input"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="교육계정_cs"
            required
          />
        </div>
        <div>
          <label className="label">시작 번호</label>
          <input
            type="number"
            className="input"
            value={startNumber}
            onChange={(e) => setStartNumber(e.target.value)}
            min="0"
            required
          />
        </div>
        {prefix && (
          <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
            <p className="font-medium mb-1">미리보기</p>
            <p>{previewFirst}, {previewSecond}, ... , {previewLast}</p>
          </div>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn-primary" disabled={isLoading}>
            {isLoading ? '변경 중...' : '일괄 변경'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
