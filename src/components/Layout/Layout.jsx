// src/components/Layout/Layout.jsx
import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const location = useLocation();

  // ルート変更時にモバイルサイドバーを閉じる
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

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
