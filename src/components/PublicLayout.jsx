import { Outlet, Link } from 'react-router-dom';

export default function PublicLayout() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ヘッダー */}
      <header className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/lp.html" className="text-lg font-bold text-blue-900 tracking-wide">
            CONSTRUCTION DX SYSTEM
          </Link>
          <Link
            to="/login"
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            ログイン
          </Link>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="flex-1 max-w-4xl mx-auto px-4 py-8 w-full">
        <Outlet />
      </main>

      {/* フッター */}
      <footer className="bg-gray-900 text-gray-400 text-sm py-8 px-4 text-center">
        <div className="flex justify-center gap-6 mb-4">
          <Link to="/legal/terms" className="hover:text-white transition">利用規約</Link>
          <Link to="/legal/privacy" className="hover:text-white transition">プライバシーポリシー</Link>
          <Link to="/legal/tokushoho" className="hover:text-white transition">特定商取引法に基づく表記</Link>
        </div>
        <p>&copy; 2026 業務改善屋さん All rights reserved.</p>
      </footer>
    </div>
  );
}
