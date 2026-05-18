import { useState } from 'react';
import toast from 'react-hot-toast';
import { accountApi } from '../../services/api';
import type { NcpAccount } from '../../types';
import Modal from '../Modal';

interface Props {
  isOpen: boolean;
  account: NcpAccount;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EditApiKeyModal({ isOpen, account, onClose, onSuccess }: Props) {
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessKey && !secretKey) {
      toast.error('최소 하나의 키를 입력해주세요');
      return;
    }
    setIsLoading(true);
    try {
      const updates: { accessKey?: string; secretKey?: string } = {};
      if (accessKey) updates.accessKey = accessKey;
      if (secretKey) updates.secretKey = secretKey;
      await accountApi.update(account.id, updates);
      toast.success('API 키가 수정되었습니다');
      onSuccess();
      setAccessKey('');
      setSecretKey('');
    } catch {
      toast.error('API 키 수정에 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="API 키 수정">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 bg-gray-50 rounded-lg text-sm">
          <p className="text-gray-600">
            계정: <strong>{account.displayName || account.accessKeyHash?.substring(0, 12)}</strong>
          </p>
          <p className="text-gray-500 text-xs mt-1">
            변경할 키만 입력하세요. 빈칸으로 둔 키는 변경되지 않습니다.
          </p>
        </div>
        <div>
          <label className="label">새 Access Key</label>
          <input
            type="text"
            className="input font-mono"
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
            placeholder="ncp_iam_..."
          />
        </div>
        <div>
          <label className="label">새 Secret Key</label>
          <input
            type="password"
            className="input font-mono"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder="ncp_iam_..."
          />
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn-primary" disabled={isLoading}>
            {isLoading ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
