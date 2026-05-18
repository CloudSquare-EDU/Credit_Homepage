import { useState, useEffect } from 'react';
import {
  UserCircleIcon,
  LockClosedIcon,
  InformationCircleIcon,
  UsersIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { authApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import type { User } from '../types';
import { formatDate } from '../utils/format';

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: '슈퍼관리자',
  ADMIN: '관리자',
  VIEWER: '뷰어',
};

const ROLE_COLOR: Record<string, string> = {
  SUPER_ADMIN: 'bg-red-100 text-red-700',
  ADMIN: 'bg-blue-100 text-blue-700',
  VIEWER: 'bg-gray-100 text-gray-600',
};

function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-5">
      <div className="w-8 h-8 bg-ncp-light rounded-lg flex items-center justify-center">
        <Icon className="h-4 w-4 text-ncp-primary" />
      </div>
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
    </div>
  );
}


export default function SettingsPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [serverStatus, setServerStatus] = useState<'ok' | 'error' | 'checking'>('checking');
  const [serverVersion, setServerVersion] = useState('-');
  const [lastChecked, setLastChecked] = useState('-');

  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  const canManageUsers = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const canChangeRole = user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    checkServerHealth();
    if (canManageUsers) loadUsers();
  }, [canManageUsers]);

  const checkServerHealth = async () => {
    setServerStatus('checking');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/health`);
      const json = await res.json();
      setServerStatus(json.status === 'ok' ? 'ok' : 'error');
      setServerVersion(json.version || '-');
      setLastChecked(new Date().toLocaleTimeString('ko-KR'));
    } catch {
      setServerStatus('error');
      setLastChecked(new Date().toLocaleTimeString('ko-KR'));
    }
  };

  const loadUsers = async () => {
    setUsersLoading(true);
    try {
      const res = await authApi.listUsers();
      if (res.success && res.data) setUsers(res.data);
    } catch {
      toast.error('사용자 목록을 불러오는데 실패했습니다');
    } finally {
      setUsersLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('새 비밀번호가 일치하지 않습니다');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('비밀번호는 8자 이상이어야 합니다');
      return;
    }
    setIsLoading(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      toast.success('비밀번호가 변경되었습니다');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      toast.error('비밀번호 변경에 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await authApi.updateUserRole(userId, role);
      toast.success('역할이 변경되었습니다');
      await loadUsers();
    } catch {
      toast.error('역할 변경에 실패했습니다');
    }
  };

  const handleToggleActive = async (targetUser: User) => {
    try {
      await authApi.toggleUserActive(targetUser.id);
      toast.success(`${targetUser.name} 계정이 ${targetUser.isActive ? '비활성화' : '활성화'}되었습니다`);
      await loadUsers();
    } catch {
      toast.error('상태 변경에 실패했습니다');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="page-title">설정</h1>
        <p className="text-sm text-gray-500 mt-0.5">계정 및 시스템 설정을 관리합니다</p>
      </div>

      {/* 상단 2열: 프로필 + 시스템 정보 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 프로필 */}
        <div className="card">
          <SectionHeader icon={UserCircleIcon} title="프로필" />
          <div className="flex items-center gap-4 mb-5">
            <div className="w-14 h-14 rounded-full bg-ncp-primary flex items-center justify-center flex-shrink-0">
              <span className="text-xl font-bold text-white">
                {user?.name?.slice(0, 1).toUpperCase()}
              </span>
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-lg leading-tight">{user?.name}</p>
              <p className="text-sm text-gray-500">{user?.email}</p>
              <span className={`mt-1.5 inline-block text-xs font-medium px-2.5 py-0.5 rounded-full ${ROLE_COLOR[user?.role || ''] || 'bg-gray-100 text-gray-600'}`}>
                {ROLE_LABEL[user?.role || ''] || user?.role}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <div className="bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-400 mb-1">가입일</p>
              <p className="text-sm font-medium text-gray-900">{formatDate(user?.createdAt)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-400 mb-1">마지막 로그인</p>
              <p className="text-sm font-medium text-gray-900">{formatDate(user?.lastLoginAt)}</p>
            </div>
          </div>
        </div>

        {/* 시스템 정보 */}
        <div className="card">
          <SectionHeader icon={InformationCircleIcon} title="시스템 정보" />
          <div className="space-y-2">
            {/* 서버 상태 */}
            <div className="bg-gray-50 rounded-lg px-4 py-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-gray-400">서버 상태</p>
                <button
                  onClick={checkServerHealth}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-ncp-primary transition-colors"
                >
                  <ArrowPathIcon className={`h-3 w-3 ${serverStatus === 'checking' ? 'animate-spin' : ''}`} />
                  새로고침
                </button>
              </div>
              <div className="flex items-center gap-2">
                {serverStatus === 'ok' ? (
                  <CheckCircleIcon className="h-5 w-5 text-green-500" />
                ) : serverStatus === 'error' ? (
                  <XCircleIcon className="h-5 w-5 text-red-500" />
                ) : (
                  <div className="h-5 w-5 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
                )}
                <span className={`text-sm font-medium ${
                  serverStatus === 'ok' ? 'text-green-700' :
                  serverStatus === 'error' ? 'text-red-700' : 'text-yellow-700'
                }`}>
                  {serverStatus === 'ok' ? '정상 운영 중' :
                   serverStatus === 'error' ? '연결 오류' : '확인 중...'}
                </span>
              </div>
              {lastChecked !== '-' && (
                <p className="text-xs text-gray-400 mt-1">마지막 확인: {lastChecked}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 rounded-lg px-4 py-3">
                <p className="text-xs text-gray-400 mb-1">버전</p>
                <p className="text-sm font-medium text-gray-900 font-mono">{serverVersion}</p>
              </div>
              <div className="bg-gray-50 rounded-lg px-4 py-3">
                <p className="text-xs text-gray-400 mb-1">API 서버</p>
                <p className="text-sm font-medium text-gray-900 font-mono truncate">
                  {import.meta.env.VITE_API_URL || '/api'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 비밀번호 변경 */}
      <div className="card">
        <SectionHeader icon={LockClosedIcon} title="비밀번호 변경" />
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div className="max-w-sm">
            <label className="label">현재 비밀번호</label>
            <input
              type="password"
              className="input"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">새 비밀번호</label>
              <input
                type="password"
                className="input"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="8자 이상"
                required
              />
            </div>
            <div>
              <label className="label">새 비밀번호 확인</label>
              <input
                type="password"
                className="input"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
              />
            </div>
          </div>
          {newPassword && confirmPassword && newPassword !== confirmPassword && (
            <p className="text-xs text-red-500">비밀번호가 일치하지 않습니다</p>
          )}
          <div className="flex justify-end">
            <button type="submit" className="btn-primary" disabled={isLoading}>
              {isLoading ? '변경 중...' : '비밀번호 변경'}
            </button>
          </div>
        </form>
      </div>

      {/* 사용자 관리 - ADMIN 이상만 표시 */}
      {canManageUsers && (
        <div className="card">
          <div className="flex items-center justify-between mb-5">
            <SectionHeader icon={UsersIcon} title="사용자 관리" />
            <button
              onClick={loadUsers}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-ncp-primary transition-colors -mt-5"
            >
              <ArrowPathIcon className={`h-3.5 w-3.5 ${usersLoading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
          </div>

          {usersLoading ? (
            <div className="text-center py-10 text-sm text-gray-500">불러오는 중...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2.5 px-3 text-xs font-medium text-gray-500">이름</th>
                    <th className="text-left py-2.5 px-3 text-xs font-medium text-gray-500">이메일</th>
                    <th className="text-left py-2.5 px-3 text-xs font-medium text-gray-500">역할</th>
                    <th className="text-left py-2.5 px-3 text-xs font-medium text-gray-500">상태</th>
                    <th className="text-left py-2.5 px-3 text-xs font-medium text-gray-500">마지막 로그인</th>
                    <th className="text-left py-2.5 px-3 text-xs font-medium text-gray-500">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-ncp-primary flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-bold text-white">
                              {u.name?.slice(0, 1).toUpperCase()}
                            </span>
                          </div>
                          <span className="font-medium text-gray-900">
                            {u.name}
                            {u.id === user?.id && (
                              <span className="ml-1.5 text-xs text-gray-400 font-normal">(나)</span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-gray-600">{u.email}</td>
                      <td className="py-3 px-3">
                        {canChangeRole && u.id !== user?.id ? (
                          <select
                            value={u.role}
                            onChange={e => handleRoleChange(u.id, e.target.value)}
                            className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-ncp-primary"
                          >
                            <option value="SUPER_ADMIN">슈퍼관리자</option>
                            <option value="ADMIN">관리자</option>
                            <option value="VIEWER">뷰어</option>
                          </select>
                        ) : (
                          <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${ROLE_COLOR[u.role] || 'bg-gray-100 text-gray-600'}`}>
                            {ROLE_LABEL[u.role] || u.role}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${u.isActive !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                          {u.isActive !== false ? '활성' : '비활성'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-gray-500 text-xs whitespace-nowrap">
                        {formatDate(u.lastLoginAt)}
                      </td>
                      <td className="py-3 px-3">
                        {u.id !== user?.id && (
                          <button
                            onClick={() => handleToggleActive(u)}
                            className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                              u.isActive !== false
                                ? 'border-red-200 text-red-600 hover:bg-red-50'
                                : 'border-green-200 text-green-600 hover:bg-green-50'
                            }`}
                          >
                            {u.isActive !== false ? '비활성화' : '활성화'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
