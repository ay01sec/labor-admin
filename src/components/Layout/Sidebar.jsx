// src/components/Layout/Sidebar.jsx
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  LayoutDashboard,
  Users,
  Building2,
  MapPin,
  FileText,
  FileSignature,
  Files,
  CalendarDays,
  ClipboardList,
  Lock,
  Settings,
  HelpCircle,
  LogOut,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

const menuItems = [
  {
    id: 'dashboard',
    path: '/',
    icon: LayoutDashboard,
    label: 'ダッシュボード',
    category: null,
    adminOnly: false
  },
  {
    id: 'employees',
    path: '/employees',
    icon: Users,
    label: '社員管理',
    category: 'マスタ管理',
    adminOnly: false
  },
  {
    id: 'clients',
    path: '/clients',
    icon: Building2,
    label: '取引先管理',
    category: 'マスタ管理',
    adminOnly: false
  },
  {
    id: 'sites',
    path: '/sites',
    icon: MapPin,
    label: '現場管理',
    category: 'マスタ管理',
    adminOnly: false
  },
  {
    id: 'reports',
    path: '/reports',
    icon: FileText,
    label: '日報管理',
    category: '業務管理',
    adminOnly: false
  },
  {
    id: 'attendance',
    path: '/reports/attendance',
    icon: ClipboardList,
    label: '勤怠集計',
    category: '集計',
    adminOnly: false,
    hidden: true
  },
  {
    id: 'contracts',
    path: '/contracts',
    icon: FileSignature,
    label: '雇用契約書',
    category: '業務管理',
    adminOnly: false  // 事務員も閲覧・編集可能
  },
  {
    id: 'documents',
    path: '/documents',
    icon: Files,
    label: '各種書類',
    category: '業務管理',
    adminOnly: false  // 事務員も閲覧・編集可能
  },
  {
    id: 'leaves',
    path: '/leaves',
    icon: CalendarDays,
    label: '有給休暇',
    category: '業務管理',
    adminOnly: false  // 事務員も閲覧・編集可能
  },
  {
    id: 'users',
    path: '/users',
    icon: Lock,
    label: 'ユーザー管理',
    category: 'システム',
    adminOnly: false  // 事務員も閲覧・編集可能
  },
  {
    id: 'settings',
    path: '/settings',
    icon: Settings,
    label: '自社情報設定',
    category: 'システム',
    adminOnly: false  // 事務員も閲覧可能（一部制限あり）
  },
  {
    id: 'help',
    path: '/help',
    icon: HelpCircle,
    label: 'ヘルプ',
    category: null,
    adminOnly: false
  },
];

export default function Sidebar({ isOpen, setIsOpen, onNavigate }) {
  const { companyInfo, userInfo, logout, isAdmin } = useAuth();

  let currentCategory = null;

  // 管理者以外は管理者専用メニューを非表示
  const visibleMenuItems = menuItems.filter(item => {
    if (item.hidden) return false;
    if (item.adminOnly && !isAdmin()) return false;
    return true;
  });

  return (
    <aside 
      className={`${
        isOpen ? 'w-64' : 'w-20'
      } bg-gray-800 text-white min-h-screen fixed left-0 top-0 transition-all duration-300 z-40 flex flex-col`}
    >
      {/* ロゴエリア */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className={`flex items-center space-x-3 ${!isOpen && 'justify-center w-full'}`}>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
              <img src="/logo-icon.png" alt="Logo" className="w-full h-full object-contain" />
            </div>
            {isOpen && (
              <div className="overflow-hidden">
                <p className="font-semibold text-sm truncate">
                  {companyInfo?.companyName || '会社名'}
                </p>
              </div>
            )}
          </div>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="text-gray-400 hover:text-white p-1 hidden lg:block"
          >
            {isOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
          </button>
        </div>
      </div>

      {/* メニュー */}
      <nav className="flex-1 p-4 overflow-y-auto">
        <ul className="space-y-1">
          {visibleMenuItems.map((item) => {
            const showCategory = item.category && item.category !== currentCategory;
            if (showCategory) currentCategory = item.category;
            const Icon = item.icon;

            return (
              <li key={item.id}>
                {showCategory && isOpen && (
                  <div className="text-xs text-gray-400 uppercase mt-4 mb-2 px-3 font-semibold">
                    {item.category}
                  </div>
                )}
                <NavLink
                  to={item.path}
                  end={item.path === '/reports'}
                  onClick={() => onNavigate && onNavigate()}
                  className={({ isActive }) =>
                    `flex items-center space-x-3 px-3 py-2.5 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-300 hover:bg-gray-700'
                    } ${!isOpen && 'justify-center'}`
                  }
                  title={!isOpen ? item.label : undefined}
                >
                  <Icon size={20} className="flex-shrink-0" />
                  {isOpen && <span className="text-sm">{item.label}</span>}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ユーザー情報 */}
      <div className="p-4 border-t border-gray-700">
        <div className={`flex items-center ${isOpen ? 'space-x-3' : 'justify-center'}`}>
          <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center flex-shrink-0">
            <Users size={16} />
          </div>
          {isOpen && (
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium truncate">
                {userInfo?.displayName || 'ユーザー'}
              </p>
              <p className="text-xs text-gray-400">
                {userInfo?.role === 'admin' ? '管理者' :
                 userInfo?.role === 'office' || userInfo?.role === 'manager' ? '事務員' :
                 userInfo?.role === 'site_manager' ? '現場管理者' : '作業員'}
              </p>
            </div>
          )}
        </div>
        <button
          onClick={logout}
          className={`flex items-center space-x-3 text-gray-400 hover:text-white mt-3 text-sm w-full px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors ${
            !isOpen && 'justify-center'
          }`}
          title={!isOpen ? 'ログアウト' : undefined}
        >
          <LogOut size={18} />
          {isOpen && <span>ログアウト</span>}
        </button>
      </div>
    </aside>
  );
}
