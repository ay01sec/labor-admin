// src/components/Layout/Header.jsx
import { useState, useRef, useEffect } from 'react';
import { Bell, Menu } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../hooks/useNotifications';
import NotificationPopup from './NotificationPopup';

export default function Header({ onMenuClick }) {
  const { userInfo } = useAuth();
  const { notifications, badgeCount } = useNotifications();
  const [showPopup, setShowPopup] = useState(false);
  const popupRef = useRef(null);

  // ポップアップ外クリックで閉じる
  useEffect(() => {
    function handleClickOutside(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        setShowPopup(false);
      }
    }
    if (showPopup) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPopup]);

  return (
    <header className="bg-white shadow-sm fixed top-0 right-0 left-0 z-30 lg:left-64">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center space-x-4">
          <button
            onClick={onMenuClick}
            className="text-gray-500 hover:text-gray-700 lg:hidden"
          >
            <Menu size={24} />
          </button>
          <h1 className="text-base sm:text-xl font-bold text-blue-600">労務管理システム</h1>
        </div>

        <div className="flex items-center space-x-4">
          {/* 通知ベル */}
          <div className="relative" ref={popupRef}>
            <button
              onClick={() => setShowPopup((prev) => !prev)}
              className="text-gray-500 hover:text-gray-700 relative p-2 rounded-lg hover:bg-gray-100"
            >
              <Bell size={20} />
              {badgeCount > 0 && (
                <span className="absolute top-1 right-1 bg-red-500 text-white text-xs rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5">
                  {badgeCount > 99 ? '99+' : badgeCount}
                </span>
              )}
            </button>

            {showPopup && (
              <NotificationPopup
                notifications={notifications}
                onClose={() => setShowPopup(false)}
              />
            )}
          </div>

          {/* ユーザー情報 */}
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-700 hidden sm:block">
              {userInfo?.displayName || 'ユーザー'}
            </span>
            {userInfo?.role === 'admin' ? (
              <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-800 font-medium">
                管理者
              </span>
            ) : (
              <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800 font-medium">
                オペレーター
              </span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
