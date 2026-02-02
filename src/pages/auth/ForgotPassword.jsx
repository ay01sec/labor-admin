// src/pages/auth/ForgotPassword.jsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Mail, ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const { resetPassword } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await resetPassword(email);
      setSuccess(true);
    } catch (err) {
      console.error('パスワードリセットエラー:', err);

      switch (err.code) {
        case 'auth/invalid-email':
          setError('メールアドレスの形式が正しくありません');
          break;
        case 'auth/user-not-found':
          setError('このメールアドレスは登録されていません');
          break;
        default:
          setError(err.message || 'パスワードリセットメールの送信に失敗しました');
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
            <Mail className="text-white" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">パスワードリセット</h1>
          <p className="text-gray-500 mt-2">
            登録済みのメールアドレスを入力してください
          </p>
        </div>

        {success ? (
          // 成功メッセージ
          <div className="text-center">
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-6 rounded-lg mb-6">
              <CheckCircle className="mx-auto mb-3" size={48} />
              <p className="font-medium mb-2">メールを送信しました</p>
              <p className="text-sm">
                {email} 宛にパスワードリセット用のリンクを送信しました。
                メールの指示に従ってパスワードを再設定してください。
              </p>
            </div>
            <Link
              to="/login"
              className="inline-flex items-center space-x-2 text-blue-600 hover:text-blue-800"
            >
              <ArrowLeft size={16} />
              <span>ログイン画面に戻る</span>
            </Link>
          </div>
        ) : (
          <>
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

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 focus:ring-4 focus:ring-blue-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span>リセットメールを送信</span>
                )}
              </button>
            </form>

            {/* ログインに戻る */}
            <div className="mt-6 text-center">
              <Link
                to="/login"
                className="inline-flex items-center space-x-2 text-sm text-blue-600 hover:text-blue-800"
              >
                <ArrowLeft size={16} />
                <span>ログイン画面に戻る</span>
              </Link>
            </div>
          </>
        )}

        {/* フッター */}
        <p className="text-center text-gray-400 text-sm mt-8">
          © 2025 Labor Management System
        </p>
      </div>
    </div>
  );
}
