import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AcademicCapIcon,
  Cog6ToothIcon,
  Bars3Icon,
  XMarkIcon,
  ArrowRightOnRectangleIcon,
  CloudIcon,
  HomeIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../hooks/useAuth';

const navigation = [
  { name: '대시보드', href: '/dashboard', icon: HomeIcon },
  { name: '과정 관리', href: '/courses', icon: AcademicCapIcon },
  { name: '설정', href: '/settings', icon: Cog6ToothIcon },
];

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-ncp-sidebar">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 px-5 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center justify-center w-8 h-8 bg-ncp-primary rounded-lg flex-shrink-0">
          <CloudIcon className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white leading-tight truncate">NCP 교육계정</p>
          <p className="text-xs text-slate-400 leading-tight">관리 시스템</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navigation.map((item) => {
          const isActive =
            location.pathname === item.href ||
            (item.href !== '/' && location.pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              to={item.href}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-ncp-primary text-white shadow-sm'
                  : 'text-slate-300 hover:bg-ncp-sidebar-hover hover:text-white'
              }`}
            >
              <item.icon className="h-5 w-5 flex-shrink-0" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-3 pb-4 flex-shrink-0">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-white/10 bg-white/5">
          <div className="w-8 h-8 rounded-full bg-ncp-primary flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-white">{getInitials(user?.name || 'U')}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{user?.name}</p>
            <p className="text-xs text-slate-400 truncate">
              {user?.role === 'SUPER_ADMIN' ? '슈퍼관리자' : user?.role === 'ADMIN' ? '관리자' : '뷰어'}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors flex-shrink-0"
            title="로그아웃"
          >
            <ArrowRightOnRectangleIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-200 ease-out lg:hidden ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="absolute top-3 right-[-44px]">
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-2 rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <SidebarContent />
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-60 lg:flex-col">
        <SidebarContent />
      </div>

      {/* Main content */}
      <div className="lg:pl-60">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 bg-white border-b border-gray-200 px-4 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <Bars3Icon className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-ncp-primary rounded flex items-center justify-center">
              <CloudIcon className="h-4 w-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-gray-900">NCP 교육계정 관리</span>
          </div>
        </header>

        {/* Page */}
        <main className="p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
