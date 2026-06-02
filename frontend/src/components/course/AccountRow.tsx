import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowPathIcon,
  PencilIcon,
  KeyIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { accountApi } from '../../services/api';
import type { NcpAccount, AccountResourceData } from '../../types';
import { formatCostExact } from '../../utils/format';
import EditApiKeyModal from '../modals/EditApiKeyModal';

interface AccountRowProps {
  account: NcpAccount;
  onRefresh: () => void;
  canEdit: boolean;
  resourceData: AccountResourceData | null;
  historicalCostData: {
    totalCost: number;
    products: Array<{ productCode: string; productName: string; useAmount: number; demandAmount: number }>;
  } | null;
  isCurrentMonth: boolean;
  cumulativeCost: number | null;
  onResourceUpdate: (resources: Record<string, number>, totalResourceCount: number, totalCost: number) => void;
}

export default function AccountRow({
  account,
  onRefresh,
  canEdit,
  resourceData,
  historicalCostData,
  isCurrentMonth,
  cumulativeCost,
  onResourceUpdate,
}: AccountRowProps) {
  const [isLoading, setIsLoading]       = useState(false);
  const [isExpanded, setIsExpanded]     = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName]         = useState(account.displayName || '');
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);

  const handleToggleMaster = async () => {
    try {
      if (account.isMaster) {
        await accountApi.unsetMaster(account.id);
        toast.success('마스터 계정이 해제되었습니다');
      } else {
        await accountApi.setMaster(account.id);
        toast.success('마스터 계정으로 지정되었습니다');
      }
      onRefresh();
    } catch {
      toast.error('마스터 계정 설정에 실패했습니다');
    }
  };

  const handleSyncResources = async () => {
    setIsLoading(true);
    try {
      const [resourceRes, costRes] = await Promise.allSettled([
        accountApi.syncResources(account.id),
        accountApi.getCosts(account.id)
      ]);

      const resources: Record<string, number> = {};
      if (resourceRes.status === 'fulfilled' && resourceRes.value.success && resourceRes.value.data) {
        const data = resourceRes.value.data as Record<string, unknown>;
        const resourceDataResult = (data.resources || data) as Record<string, number>;
        Object.entries(resourceDataResult).forEach(([key, value]) => {
          if (key === 'subAccounts') return;
          if (typeof value === 'number' && value > 0) resources[key] = value;
        });
      }

      let totalCost = 0;
      if (costRes.status === 'fulfilled' && costRes.value.success && costRes.value.data) {
        const costData = costRes.value.data as { totalUseAmount?: number; totalDemandAmount?: number; invoiceDemandAmount?: number };
        totalCost = costData.invoiceDemandAmount ?? costData.totalDemandAmount ?? costData.totalUseAmount ?? 0;
      }

      const totalResourceCount = Object.values(resources).reduce((sum, count) => sum + count, 0);
      onResourceUpdate(resources, totalResourceCount, totalCost);
      setIsExpanded(true);
      toast.success('리소스 정보를 가져왔습니다');
    } catch {
      toast.error('리소스 정보를 가져오는데 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveName = async () => {
    const trimmed = editName.trim();
    if (!trimmed) { toast.error('이름을 입력해주세요'); return; }
    try {
      await accountApi.update(account.id, { displayName: trimmed });
      toast.success('이름이 수정되었습니다');
      setIsEditingName(false);
      onRefresh();
    } catch {
      toast.error('이름 수정에 실패했습니다');
    }
  };

  const handleCancelEdit = () => {
    setEditName(account.displayName || '');
    setIsEditingName(false);
  };

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50 group">
        {/* 이름 */}
        <td className="py-3 px-4">
          {isEditingName ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                className="input py-1 px-2 text-sm w-32"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') handleCancelEdit(); }}
                autoFocus
              />
              <button onClick={handleSaveName} className="p-1 text-green-600 hover:bg-green-50 rounded">
                <CheckIcon className="h-4 w-4" />
              </button>
              <button onClick={handleCancelEdit} className="p-1 text-gray-400 hover:bg-gray-100 rounded">
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <Link to={`/accounts/${account.id}`} className="font-medium text-gray-900 hover:text-ncp-primary">
                {account.displayName || '-'}
              </Link>
              {account.isMaster && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-purple-100 text-purple-700 rounded border border-purple-200">마스터</span>
              )}
              {account.ncpMemberNo && !account.isMaster && (
                <span className="text-[10px] text-gray-400 font-mono">#{account.ncpMemberNo}</span>
              )}
              {canEdit && (
                <>
                  <button onClick={() => setIsEditingName(true)} className="p-1 text-gray-400 hover:text-ncp-primary rounded opacity-0 group-hover:opacity-100 transition-opacity" title="이름 수정">
                    <PencilIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={handleToggleMaster}
                    className={`px-1.5 py-0.5 text-[10px] rounded border opacity-0 group-hover:opacity-100 transition-opacity ${account.isMaster ? 'text-purple-600 border-purple-300 hover:bg-purple-50' : 'text-gray-400 border-gray-300 hover:bg-gray-50'}`}
                    title={account.isMaster ? '마스터 해제' : '마스터로 지정'}
                  >
                    {account.isMaster ? '해제' : '마스터'}
                  </button>
                </>
              )}
            </div>
          )}
        </td>

        {/* ACCESS KEY */}
        <td className="py-3 px-4 text-sm text-gray-500 font-mono">
          <div className="flex items-center gap-1">
            <span>{account.accessKeyHash?.substring(0, 12)}...</span>
            {canEdit && (
              <button onClick={() => setIsKeyModalOpen(true)} className="p-1 text-gray-400 hover:text-ncp-primary rounded" title="API 키 수정">
                <KeyIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        </td>

        {/* 서브계정 수 */}
        <td className="py-3 px-4 text-center text-sm font-medium">
          {account._count?.subAccounts || 0}
        </td>

        {/* 리소스 */}
        <td className="py-3 px-4 text-center">
          <div className="flex items-center justify-center gap-1">
            <button onClick={handleSyncResources} disabled={isLoading} className="p-1.5 text-gray-400 hover:text-ncp-primary hover:bg-gray-100 rounded" title="리소스 조회">
              <ArrowPathIcon className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            {(resourceData || (!isCurrentMonth && historicalCostData)) && (
              <button onClick={() => setIsExpanded(!isExpanded)} className="p-1.5 text-gray-400 hover:text-ncp-primary hover:bg-gray-100 rounded" title={isExpanded ? '접기' : '펼치기'}>
                {isExpanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
              </button>
            )}
            {isCurrentMonth && resourceData && (
              <span className={`ml-1 text-xs font-medium ${resourceData.totalResourceCount > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                {resourceData.totalResourceCount}개
              </span>
            )}
            {!isCurrentMonth && historicalCostData && (
              <span className={`ml-1 text-xs font-medium ${historicalCostData.products.length > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                {historicalCostData.products.length}종
              </span>
            )}
          </div>
        </td>

        {/* 이번 달 비용 */}
        <td className="py-3 px-4 text-right">
          {!isCurrentMonth ? (
            historicalCostData ? (
              historicalCostData.totalCost > 0
                ? <span className="font-medium text-ncp-primary">{formatCostExact(historicalCostData.totalCost)}</span>
                : <span className="text-gray-400 text-sm">0원</span>
            ) : <span className="text-gray-300 text-sm">-</span>
          ) : (
            resourceData?.totalCost && resourceData.totalCost > 0
              ? <span className="font-medium text-ncp-primary">{formatCostExact(resourceData.totalCost)}</span>
              : resourceData ? <span className="text-gray-400 text-sm">0원</span> : <span className="text-gray-300 text-sm">-</span>
          )}
        </td>

        {/* 전체 사용료 */}
        <td className="py-3 px-4 text-right">
          {cumulativeCost != null ? (
            cumulativeCost > 0
              ? <span className="font-bold text-blue-700">{formatCostExact(cumulativeCost)}</span>
              : <span className="text-gray-400 text-sm">0원</span>
          ) : <span className="text-gray-300 text-sm">-</span>}
        </td>
      </tr>

      {/* 확장 행 — 리소스/서비스 상세 */}
      {isExpanded && (isCurrentMonth ? resourceData : (resourceData || historicalCostData)) && (
        <tr className="bg-gray-50">
          <td colSpan={6} className="px-4 py-3">
            <div className="pl-4 space-y-3">
              {isCurrentMonth && resourceData && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">현재 보유 리소스:</p>
                  {Object.keys(resourceData.resources).length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(resourceData.resources).map(([type, count]) => (
                        <span key={type} className="px-2 py-1 bg-white border border-gray-200 text-xs text-gray-700 rounded">
                          {type}: <span className="font-medium text-red-600">{count}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-green-600">보유 중인 리소스가 없습니다 ✓</p>
                  )}
                </div>
              )}

              {isCurrentMonth && resourceData && (resourceData.services ?? []).length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-gray-500 mb-2">이용 중인 서비스 (당월 청구):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(resourceData.services ?? []).map((svc, i) => (
                      <span key={i} className="px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-full">{svc}</span>
                    ))}
                  </div>
                </div>
              )}

              {!isCurrentMonth && historicalCostData && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">해당 월 사용 서비스:</p>
                  {historicalCostData.products.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {historicalCostData.products.map((product) => (
                        <span key={product.productCode} className="px-2 py-1 bg-white border border-blue-200 text-xs text-gray-700 rounded">
                          {product.productName}: <span className="font-medium text-blue-600">{formatCostExact(product.demandAmount || product.useAmount)}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">해당 월 사용 내역이 없습니다</p>
                  )}
                </div>
              )}

              {!isCurrentMonth && !historicalCostData && resourceData && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">현재 보유 리소스 (과거 비용 조회 필요):</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(resourceData.resources).map(([type, count]) => (
                      <span key={type} className="px-2 py-1 bg-white border border-gray-200 text-xs text-gray-700 rounded">
                        {type}: <span className="font-medium text-red-600">{count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}

      <EditApiKeyModal
        isOpen={isKeyModalOpen}
        account={account}
        onClose={() => setIsKeyModalOpen(false)}
        onSuccess={() => { setIsKeyModalOpen(false); onRefresh(); }}
      />
    </>
  );
}
