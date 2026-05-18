import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CloudIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await login(email, password);
      toast.success('로그인 성공');
      navigate('/');
    } catch (error) {
      toast.error('이메일 또는 비밀번호를 확인하세요');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-ncp-sidebar p-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-ncp-primary rounded-xl flex items-center justify-center">
            <CloudIcon className="h-6 w-6 text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-lg leading-tight">NCP 교육계정</p>
            <p className="text-slate-400 text-sm">관리 시스템</p>
          </div>
        </div>

        <div>
          <h2 className="text-4xl font-bold text-white leading-snug mb-4">
            클라우드 교육 계정을<br />
            <span className="text-ncp-primary">효율적으로 관리</span>하세요
          </h2>
          <p className="text-slate-400 text-base leading-relaxed">
            NCP 교육 과정의 계정 동기화, 비용 모니터링,<br />
            리소스 정리를 한 곳에서 처리합니다.
          </p>
        </div>

        <div className="flex items-center gap-6 text-slate-500 text-sm">
          <span>© 2025 Cloudsquare</span>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center bg-slate-50 p-8">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="w-9 h-9 bg-ncp-primary rounded-xl flex items-center justify-center">
              <CloudIcon className="h-5 w-5 text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900">NCP 교육계정 관리</span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-1">로그인</h1>
            <p className="text-gray-500 text-sm">관리자 계정으로 로그인하세요</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="label">이메일</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="label">비밀번호</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword
                    ? <EyeSlashIcon className="h-4 w-4" />
                    : <EyeIcon className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="btn-primary w-full py-2.5"
              disabled={isLoading}
            >
              {isLoading
                ? <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                    </svg>
                    로그인 중...
                  </span>
                : '로그인'}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-gray-400">
            초기 계정: admin@example.com / admin1234!
          </p>
        </div>
      </div>
    </div>
  );
}
