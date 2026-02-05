// src/pages/auth/Login.jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Eye, EyeOff, LogIn, AlertCircle, Building } from 'lucide-react';

export default function Login() {
  const [companyCode, setCompanyCode] = useState(() => {
    return localStorage.getItem('lastCompanyCode') || '';
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleCompanyCodeChange = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 8);
    setCompanyCode(value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (companyCode.length !== 8) {
      setError('企業IDは8桁の数字で入力してください');
      return;
    }

    setLoading(true);

    try {
      await login(companyCode, email, password);
      navigate('/');
    } catch (err) {
      console.error('ログインエラー:', err);

      switch (err.code) {
        case 'auth/invalid-email':
          setError('メールアドレスの形式が正しくありません');
          break;
        case 'auth/user-not-found':
          setError('ユーザーが見つかりません');
          break;
        case 'auth/wrong-password':
          setError('パスワードが正しくありません');
          break;
        case 'auth/invalid-credential':
          setError('メールアドレスまたはパスワードが正しくありません');
          break;
        case 'auth/too-many-requests':
          setError('ログイン試行回数が多すぎます。しばらく待ってから再度お試しください');
          break;
        default:
          setError(err.message || 'ログインに失敗しました');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        {/* ロゴ・タイトル */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-500 rounded-2xl mx-auto mb-4 flex items-center justify-center text-3xl shadow-lg">
            🏗️
          </div>
          <h1 className="text-2xl font-bold text-gray-800">労務管理システム</h1>
          <p className="text-gray-500 mt-2">管理画面にログイン</p>
        </div>

        {/* エラーメッセージ */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-start space-x-3">
            <AlertCircle className="flex-shrink-0 mt-0.5" size={18} />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* フォーム */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <span className="flex items-center space-x-1">
                <Building size={16} />
                <span>企業ID</span>
              </span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={companyCode}
              onChange={handleCompanyCodeChange}
              placeholder="12345678"
              maxLength={8}
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors tracking-widest font-mono text-lg"
            />
            <p className="mt-1 text-xs text-gray-500">8桁の数字</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              メールアドレス
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@email.com"
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              パスワード
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 focus:ring-4 focus:ring-blue-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <LogIn size={20} />
                <span>ログイン</span>
              </>
            )}
          </button>
        </form>

        {/* パスワードを忘れた場合 */}
        <div className="mt-6 text-center">
          <Link
            to="/forgot-password"
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            パスワードをお忘れですか？
          </Link>
        </div>

        {/* 新規利用開始 */}
        <div className="mt-6 pt-6 border-t border-gray-200">
          <p className="text-center text-sm text-gray-500 mb-3">
            まだアカウントをお持ちでない方
          </p>
          <Link
            to="/register"
            className="block w-full text-center py-3 border-2 border-blue-600 text-blue-600 rounded-lg font-medium hover:bg-blue-50 transition-colors"
          >
            新規利用開始
          </Link>
        </div>

        {/* フッター */}
        <p className="text-center text-gray-400 text-sm mt-8">
          © 2026 Labor Management System
        </p>
      </div>
    </div>
  );
}
