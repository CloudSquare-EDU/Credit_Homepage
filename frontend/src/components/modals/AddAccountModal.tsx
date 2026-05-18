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

export default function AddAccountModal({ isOpen, onClose, courseId, onSuccess }: Props) {
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isMaster, setIsMaster] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await accountApi.add(courseId, accessKey, secretKey, displayName, isMaster);
      toast.success(isMaster ? '마스터 계정이 추가되었습니다' : '계정이 추가되었습니다');
      onSuccess();
      setAccessKey('');
      setSecretKey('');
      setDisplayName('');
      setIsMaster(false);
    } catch {
      toast.error('계정 추가에 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="계정 추가">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">이름</label>
          <input
            type="text"
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="학생 이름"
          />
        </div>
        <div>
          <label className="label">Access Key *</label>
          <input
            type="text"
            className="input font-mono"
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
            placeholder="ncp_iam_..."
            required
          />
        </div>
        <div>
          <label className="label">Secret Key *</label>
          <input
            type="password"
            className="input font-mono"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder="ncp_iam_..."
            required
          />
        </div>
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isMaster}
              onChange={(e) => setIsMaster(e.target.checked)}
              className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
            />
            <span className="text-sm text-gray-700">Organization 마스터 계정으로 지정</span>
          </label>
          {isMaster && (
            <p className="mt-1 text-xs text-purple-600 pl-6">
              기존 마스터 계정이 있으면 자동으로 해제됩니다. 전체 사용료 조회 시 이 계정으로 조직 전체 비용을 조회합니다.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn-primary" disabled={isLoading}>
            {isLoading ? '추가 중...' : '추가'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
