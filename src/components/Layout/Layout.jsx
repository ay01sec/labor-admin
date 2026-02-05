// src/components/Layout/Layout.jsx
import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { XCircle, LogOut } from 'lucide-react';
import Sidebar from './Sidebar';
import Header from './Header';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const location = useLocation();
  const { companyInfo, logout } = useAuth();

  // ルート変更時にモバイルサイドバーを閉じる
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  // 解約済みの場合、全機能をブロック
  if (companyInfo?.billing?.status === 'canceled') {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 text-center">
          <div className="w-20 h-20 bg-red-100 rounded-full mx-auto mb-6 flex items-center justify-center">
            <XCircle className="text-red-500" size={40} />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-3">
            ご利用が停止されています
          </h1>
          <p className="text-gray-600 mb-2">
            この企業アカウントは解約済みです。
          </p>
          <p className="text-sm text-gray-500 mb-8">
            全ての機能がご利用いただけません。再度ご利用を希望される場合は、お問い合わせください。
          </p>
          <button
            onClick={logout}
            className="inline-flex items-center space-x-2 bg-gray-800 text-white px-6 py-3 rounded-lg hover:bg-gray-900 transition-colors"
          >
            <LogOut size={18} />
            <span>ログアウト</span>
          </button>
          <p className="text-center text-gray-400 text-sm mt-8">
            &copy; 2026 Labor Management System
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* モバイル用オーバーレイ */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* サイドバー - デスクトップ */}
      <div className="hidden lg:block">
        <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
      </div>

      {/* サイドバー - モバイル */}
      <div
        className={`lg:hidden fixed inset-y-0 left-0 z-40 w-64 transform ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } transition-transform duration-300`}
      >
        <Sidebar isOpen={true} setIsOpen={() => setMobileSidebarOpen(false)} onNavigate={() => setMobileSidebarOpen(false)} />
      </div>

      {/* ヘッダー */}
      <div className={sidebarOpen ? 'lg:pl-64' : 'lg:pl-20'}>
        <Header onMenuClick={() => setMobileSidebarOpen(true)} />
      </div>

      {/* メインコンテンツ */}
      <main
        className={`pt-16 min-h-screen transition-all duration-300 ${
          sidebarOpen ? 'lg:ml-64' : 'lg:ml-20'
        }`}
      >
        <div className="p-4 sm:p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
