import { useState } from 'react';
import toast from 'react-hot-toast';
import { accountApi } from '../../services/api';
import type { NcpAccount } from '../../types';
import Modal from '../Modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
  accounts: NcpAccount[];
  onSuccess: () => void;
}

export default function MemberNoModal({ isOpen, onClose, courseId, accounts, onSuccess }: Props) {
  const [rawInput, setRawInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [preview, setPreview] = useState<Array<{ displayName: string; memberNo: string; found: boolean }>>([]);

  const parseInput = (text: string) => {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    return lines.map(line => {
      const parts = line.split(/\t|\s{2,}/).map(p => p.trim()).filter(Boolean);
      let displayName = '';
      let memberNo = '';
      for (const part of parts) {
        if (/^\d{6,}$/.test(part)) memberNo = part;
        else if (part.length > 2 && !/^\d+$/.test(part)) displayName = part;
      }
      const found = accounts.some(a => a.displayName === displayName);
      return { displayName, memberNo, found };
    }).filter(p => p.displayName && p.memberNo);
  };

  const handleInputChange = (text: string) => {
    setRawInput(text);
    setPreview(parseInput(text));
  };

  const handleSubmit = async () => {
    const assignments = preview
      .filter(p => p.found)
      .map(p => ({ displayName: p.displayName, memberNo: p.memberNo }));

    if (assignments.length === 0) {
      toast.error('매칭된 계정이 없습니다');
      return;
    }

    setIsLoading(true);
    try {
      const res = await accountApi.bulkSetMemberNumbers(courseId, assignments);
      if (res.success && res.data) {
        toast.success(`${res.data.updated}개 계정 회원번호 저장 완료`);
        onSuccess();
        setRawInput('');
        setPreview([]);
      }
    } catch {
      toast.error('회원번호 저장에 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  const matchedCount = preview.filter(p => p.found).length;
  const notFoundCount = preview.filter(p => !p.found).length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="회원번호 일괄 설정" size="lg">
      <div className="space-y-4">
        <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-800">
          <p className="font-medium mb-1">엑셀에서 복사 방법</p>
          <p>계정명 컬럼과 회원번호 컬럼을 선택 후 복사(Ctrl+C)하여 아래에 붙여넣기 하세요.</p>
          <p className="text-xs mt-1 text-blue-600">예: <code>교육계정_cs091[탭]3697296</code></p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label mb-0">계정명 + 회원번호 붙여넣기</label>
            {preview.length > 0 && <span className="text-xs text-gray-500">{preview.length}행 파싱됨</span>}
          </div>
          <textarea
            className="input font-mono text-sm"
            rows={8}
            value={rawInput}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder={'교육계정_cs091\t3697296\n교육계정_cs092\t3697297\n...'}
          />
        </div>

        {preview.length > 0 && (
          <div>
            <div className="flex gap-3 mb-2 text-xs">
              <span className="text-green-600 font-medium">✓ 매칭 {matchedCount}개</span>
              {notFoundCount > 0 && (
                <span className="text-red-500">✗ 미매칭 {notFoundCount}개 (계정명 불일치)</span>
              )}
            </div>
            <div className="max-h-40 overflow-y-auto border rounded-lg divide-y text-xs">
              {preview.slice(0, 20).map((p, i) => (
                <div key={i} className={`flex items-center justify-between px-3 py-1.5 ${p.found ? 'bg-white' : 'bg-red-50'}`}>
                  <span className={`flex-1 ${p.found ? 'text-gray-700' : 'text-red-500'}`}>{p.displayName}</span>
                  <span className="font-mono text-gray-500 mr-4">{p.memberNo}</span>
                  <span>{p.found ? '✓' : '✗'}</span>
                </div>
              ))}
              {preview.length > 20 && (
                <div className="px-3 py-1.5 text-gray-400 text-center">... 외 {preview.length - 20}개</div>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2 border-t">
          <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
          <button onClick={handleSubmit} className="btn-primary" disabled={isLoading || matchedCount === 0}>
            {isLoading ? '저장 중...' : `${matchedCount}개 저장`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
