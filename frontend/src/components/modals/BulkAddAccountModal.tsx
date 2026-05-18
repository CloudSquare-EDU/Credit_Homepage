import { useState } from 'react';
import toast from 'react-hot-toast';
import { accountApi } from '../../services/api';
import Modal from '../Modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
  onSuccess: () => void;
}

export default function BulkAddAccountModal({ isOpen, onClose, courseId, onSuccess }: Props) {
  const [accessKeys, setAccessKeys] = useState('');
  const [secretKeys, setSecretKeys] = useState('');
  const [startNumber, setStartNumber] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const accessList = accessKeys.split('\n').map(k => k.trim()).filter(Boolean);
  const secretList = secretKeys.split('\n').map(k => k.trim()).filter(Boolean);
  const lineCountMismatch = accessList.length > 0 && secretList.length > 0 && accessList.length !== secretList.length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (accessList.length !== secretList.length) {
      toast.error('Access Key와 Secret Key 개수가 일치하지 않습니다');
      return;
    }

    const accounts = accessList.map((accessKey, i) => ({
      accessKey,
      secretKey: secretList[i],
    }));

    setIsLoading(true);
    try {
      const response = await accountApi.addBulk(
        courseId,
        accounts,
        startNumber ? parseInt(startNumber) : undefined
      );
      if (response.success && response.data) {
        toast.success(`${response.data.success}개 계정이 추가되었습니다`);
        if (response.data.failed > 0) toast.error(`${response.data.failed}개 계정 추가 실패`);
      }
      onSuccess();
      setAccessKeys('');
      setSecretKeys('');
      setStartNumber('');
    } catch {
      toast.error('계정 추가에 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="계정 일괄 추가" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">시작 번호 (자동 이름 생성)</label>
          <input
            type="number"
            className="input"
            value={startNumber}
            onChange={(e) => setStartNumber(e.target.value)}
            placeholder="1 (→ 교육계정_cs001, 교육계정_cs002, ...)"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label mb-0">Access Keys (한 줄에 하나씩) *</label>
            {accessList.length > 0 && <span className="text-xs text-gray-500">{accessList.length}개</span>}
          </div>
          <textarea
            className="input font-mono text-sm"
            rows={6}
            value={accessKeys}
            onChange={(e) => setAccessKeys(e.target.value)}
            placeholder={"ncp_iam_BPAMKRxxxxxxxxxxxx\nncp_iam_BPAMKRxxxxxxxxxxxx\n..."}
            required
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label mb-0">Secret Keys (한 줄에 하나씩) *</label>
            {secretList.length > 0 && (
              <span className={`text-xs ${lineCountMismatch ? 'text-red-500 font-medium' : 'text-gray-500'}`}>
                {secretList.length}개{lineCountMismatch ? ` (Access Key ${accessList.length}개와 불일치)` : ''}
              </span>
            )}
          </div>
          <textarea
            className={`input font-mono text-sm ${lineCountMismatch ? 'border-red-400 focus:ring-red-400' : ''}`}
            rows={6}
            value={secretKeys}
            onChange={(e) => setSecretKeys(e.target.value)}
            placeholder={"ncp_iam_BPKMKRxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nncp_iam_BPKMKRxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n..."}
            required
          />
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn-primary" disabled={isLoading || lineCountMismatch}>
            {isLoading ? '추가 중...' : '일괄 추가'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
