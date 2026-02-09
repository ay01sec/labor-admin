// src/pages/auth/Login.jsx
import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { RecaptchaVerifier } from 'firebase/auth';
import { auth } from '../../services/firebase';
import { Eye, EyeOff, LogIn, AlertCircle, Building, Smartphone, Key, ArrowLeft } from 'lucide-react';

export default function Login() {
  const [companyCode, setCompanyCode] = useState(() => {
    return localStorage.getItem('lastCompanyCode') || '';
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // MFA関連の状態
  const [mfaStep, setMfaStep] = useState(null); // null | 'select' | 'sms' | 'totp'
  const [mfaHints, setMfaHints] = useState([]);
  const [selectedMfaHint, setSelectedMfaHint] = useState(null);
  const [verificationId, setVerificationId] = useState(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);

  const recaptchaContainerRef = useRef(null);
  const recaptchaVerifierRef = useRef(null);

  const {
    login,
    sendMfaSmsCode,
    verifyMfaSmsCode,
    verifyMfaTotpCode,
    mfaResolver,
    // カスタム2FA
    requires2FA,
    pending2FAUser,
    send2FACode,
    verify2FACode,
    cancel2FA,
    twoFACodeSent,
    twoFADevCode
  } = useAuth();
  const navigate = useNavigate();

  // カスタム2FA関連の状態（コード入力値のみローカル）
  const [custom2FACode, setCustom2FACode] = useState('');
  const [sending2FACode, setSending2FACode] = useState(false);

  // デバッグ: レンダリング時の状態をログ
  console.log('Login render - twoFACodeSent:', twoFACodeSent, 'twoFADevCode:', twoFADevCode, 'requires2FA:', requires2FA, 'pending2FAUser:', !!pending2FAUser);

  // reCAPTCHA初期化
  useEffect(() => {
    if (mfaStep === 'sms' && recaptchaContainerRef.current && !recaptchaVerifierRef.current) {
      recaptchaVerifierRef.current = new RecaptchaVerifier(auth, recaptchaContainerRef.current, {
        size: 'invisible',
        callback: () => {
          // reCAPTCHA solved
        }
      });
    }
  }, [mfaStep]);

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

      // MFA認証が必要な場合
      if (err.code === 'mfa-required') {
        const hints = err.resolver.hints;
        setMfaHints(hints);
        if (hints.length === 1) {
          // 1つのMFAのみ登録されている場合は自動選択
          handleSelectMfa(hints[0]);
        } else {
          setMfaStep('select');
        }
        return;
      }

      // カスタム2FA認証が必要な場合
      if (err.code === 'custom-2fa-required') {
        console.log('2FA required, pending data:', err.pending2FAData);
        const companyId = err.pending2FAData?.company?.id;
        console.log('Company ID for 2FA:', companyId);
        if (companyId) {
          await handleSendCustom2FACode(companyId);
        } else {
          setError('2FA認証の初期化に失敗しました。再度ログインしてください。');
        }
        return;
      }

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

  const handleSelectMfa = async (hint) => {
    setSelectedMfaHint(hint);
    setError('');

    if (hint.factorId === 'phone') {
      setMfaStep('sms');
      // SMS送信
      await handleSendSmsCode(hint);
    } else if (hint.factorId === 'totp') {
      setMfaStep('totp');
    }
  };

  const handleSendSmsCode = async (hint) => {
    setSendingCode(true);
    setError('');

    try {
      // reCAPTCHA初期化を待つ
      if (!recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', {
          size: 'invisible'
        });
      }

      const verId = await sendMfaSmsCode(hint, recaptchaVerifierRef.current);
      setVerificationId(verId);
    } catch (err) {
      console.error('SMS送信エラー:', err);
      setError('SMSの送信に失敗しました。しばらくしてから再度お試しください。');
    } finally {
      setSendingCode(false);
    }
  };

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mfaStep === 'sms') {
        await verifyMfaSmsCode(verificationId, verificationCode);
      } else if (mfaStep === 'totp') {
        await verifyMfaTotpCode(selectedMfaHint.uid, verificationCode);
      }
      navigate('/');
    } catch (err) {
      console.error('認証エラー:', err);
      setError('認証コードが正しくありません');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setMfaStep(null);
    setMfaHints([]);
    setSelectedMfaHint(null);
    setVerificationId(null);
    setVerificationCode('');
    setError('');
  };

  // カスタム2FA: コード送信
  const handleSendCustom2FACode = async (companyIdOverride = null) => {
    console.log('handleSendCustom2FACode called with:', companyIdOverride);
    setSending2FACode(true);
    setError('');
    try {
      console.log('Calling send2FACode...');
      const result = await send2FACode(companyIdOverride);
      console.log('send2FACode result:', result);
      // context内で twoFACodeSent と twoFADevCode が設定される
      console.log('handleSendCustom2FACode completed successfully');
    } catch (err) {
      console.error('2FAコード送信エラー:', err);
      console.error('Error details:', err.code, err.message);
      setError('認証コードの送信に失敗しました: ' + (err.message || '不明なエラー'));
    } finally {
      setSending2FACode(false);
    }
  };

  // カスタム2FA: コード検証
  const handleVerifyCustom2FACode = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await verify2FACode(custom2FACode);
      navigate('/');
    } catch (err) {
      console.error('2FA検証エラー:', err);
      if (err.code === 'functions/deadline-exceeded') {
        setError('認証コードの有効期限が切れました。再度コードを送信してください。');
      } else if (err.code === 'functions/invalid-argument') {
        setError('認証コードが正しくありません');
      } else {
        setError(err.message || '認証に失敗しました');
      }
    } finally {
      setLoading(false);
    }
  };

  // カスタム2FA: キャンセル
  const handleCancelCustom2FA = async () => {
    await cancel2FA();
    // context内で twoFACodeSent と twoFADevCode がリセットされる
    setCustom2FACode('');
    setError('');
  };

  // カスタム2FA認証コード入力画面
  if (twoFACodeSent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-500 rounded-2xl mx-auto mb-4 flex items-center justify-center text-3xl shadow-lg">
              ✉️
            </div>
            <h1 className="text-2xl font-bold text-gray-800">2段階認証</h1>
            <p className="text-gray-500 mt-2">
              {pending2FAUser?.email} に送信された<br />
              6桁の認証コードを入力してください
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-start space-x-3">
              <AlertCircle className="flex-shrink-0 mt-0.5" size={18} />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* 開発用: SMTP未設定時のコード表示 */}
          {twoFADevCode && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg mb-6">
              <p className="text-xs font-medium">開発用（SMTP未設定）</p>
              <p className="text-2xl font-mono font-bold tracking-widest">{twoFADevCode}</p>
            </div>
          )}

          <form onSubmit={handleVerifyCustom2FACode} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                認証コード
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={custom2FACode}
                onChange={(e) => setCustom2FACode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                required
                autoFocus
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors tracking-widest font-mono text-2xl text-center"
              />
            </div>

            <button
              type="submit"
              disabled={loading || custom2FACode.length !== 6}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 focus:ring-4 focus:ring-blue-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn size={20} />
                  <span>認証</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={handleSendCustom2FACode}
              disabled={sending2FACode}
              className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
            >
              {sending2FACode ? '送信中...' : 'コードを再送信'}
            </button>
          </div>

          <button
            onClick={handleCancelCustom2FA}
            className="mt-6 w-full flex items-center justify-center space-x-2 text-gray-600 hover:text-gray-800"
          >
            <ArrowLeft size={18} />
            <span>ログインに戻る</span>
          </button>
        </div>
      </div>
    );
  }

  // MFA選択画面
  if (mfaStep === 'select') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-500 rounded-2xl mx-auto mb-4 flex items-center justify-center text-3xl shadow-lg">
              <Key className="text-white" size={32} />
            </div>
            <h1 className="text-2xl font-bold text-gray-800">2段階認証</h1>
            <p className="text-gray-500 mt-2">認証方法を選択してください</p>
          </div>

          <div className="space-y-3">
            {mfaHints.map((hint, index) => (
              <button
                key={index}
                onClick={() => handleSelectMfa(hint)}
                className="w-full flex items-center space-x-4 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                {hint.factorId === 'phone' ? (
                  <Smartphone className="text-blue-600" size={24} />
                ) : (
                  <Key className="text-green-600" size={24} />
                )}
                <div className="text-left">
                  <p className="font-medium text-gray-800">
                    {hint.factorId === 'phone' ? 'SMS認証' : '認証アプリ'}
                  </p>
                  <p className="text-sm text-gray-500">
                    {hint.displayName || (hint.factorId === 'phone' ? hint.phoneNumber : 'TOTP')}
                  </p>
                </div>
              </button>
            ))}
          </div>

          <button
            onClick={handleBackToLogin}
            className="mt-6 w-full flex items-center justify-center space-x-2 text-gray-600 hover:text-gray-800"
          >
            <ArrowLeft size={18} />
            <span>ログインに戻る</span>
          </button>
        </div>
      </div>
    );
  }

  // MFA認証コード入力画面
  if (mfaStep === 'sms' || mfaStep === 'totp') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-500 rounded-2xl mx-auto mb-4 flex items-center justify-center text-3xl shadow-lg">
              {mfaStep === 'sms' ? (
                <Smartphone className="text-white" size={32} />
              ) : (
                <Key className="text-white" size={32} />
              )}
            </div>
            <h1 className="text-2xl font-bold text-gray-800">2段階認証</h1>
            <p className="text-gray-500 mt-2">
              {mfaStep === 'sms'
                ? 'SMSで送信された6桁のコードを入力してください'
                : '認証アプリに表示されている6桁のコードを入力してください'}
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-start space-x-3">
              <AlertCircle className="flex-shrink-0 mt-0.5" size={18} />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <form onSubmit={handleVerifyCode} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                認証コード
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                required
                autoFocus
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors tracking-widest font-mono text-2xl text-center"
              />
            </div>

            <button
              type="submit"
              disabled={loading || verificationCode.length !== 6}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 focus:ring-4 focus:ring-blue-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn size={20} />
                  <span>認証</span>
                </>
              )}
            </button>
          </form>

          {mfaStep === 'sms' && (
            <div className="mt-4 text-center">
              <button
                onClick={() => handleSendSmsCode(selectedMfaHint)}
                disabled={sendingCode}
                className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
              >
                {sendingCode ? '送信中...' : 'コードを再送信'}
              </button>
            </div>
          )}

          <button
            onClick={handleBackToLogin}
            className="mt-6 w-full flex items-center justify-center space-x-2 text-gray-600 hover:text-gray-800"
          >
            <ArrowLeft size={18} />
            <span>ログインに戻る</span>
          </button>

          {/* reCAPTCHA container */}
          <div id="recaptcha-container" ref={recaptchaContainerRef}></div>
        </div>
      </div>
    );
  }

  // 通常のログイン画面
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        {/* ロゴ・タイトル */}
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex items-center justify-center">
            <img src="/logo-with-text.png" alt="CONSTRUCTION DX SYSTEM" className="h-20 object-contain" />
          </div>
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
