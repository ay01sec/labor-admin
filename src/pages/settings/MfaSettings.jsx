// src/pages/settings/MfaSettings.jsx
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { RecaptchaVerifier } from 'firebase/auth';
import { auth } from '../../services/firebase';
import QRCode from 'qrcode';
import {
  Shield,
  Smartphone,
  Key,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle,
  ArrowLeft,
  Loader2,
  Copy
} from 'lucide-react';

export default function MfaSettings() {
  const navigate = useNavigate();
  const {
    currentUser,
    userInfo,
    isAdmin,
    getEnrolledMfaFactors,
    enrollSmsMfa,
    completeSmsMfaEnrollment,
    startTotpEnrollment,
    completeTotpEnrollment,
    unenrollMfa,
    requiresMfaSetup
  } = useAuth();

  const [enrolledFactors, setEnrolledFactors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // SMS登録
  const [showSmsForm, setShowSmsForm] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [smsVerificationId, setSmsVerificationId] = useState(null);
  const [smsCode, setSmsCode] = useState('');
  const [sendingSms, setSendingSms] = useState(false);

  // TOTP登録
  const [showTotpForm, setShowTotpForm] = useState(false);
  const [totpSecret, setTotpSecret] = useState(null);
  const [totpQrCode, setTotpQrCode] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const recaptchaContainerRef = useRef(null);
  const recaptchaVerifierRef = useRef(null);

  // 登録済みMFA一覧を取得
  useEffect(() => {
    if (currentUser) {
      setEnrolledFactors(getEnrolledMfaFactors());
    }
  }, [currentUser, getEnrolledMfaFactors]);

  // reCAPTCHA初期化
  useEffect(() => {
    if (showSmsForm && !recaptchaVerifierRef.current) {
      recaptchaVerifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container-mfa', {
        size: 'invisible'
      });
    }
  }, [showSmsForm]);

  const handleSendSmsCode = async () => {
    if (!phoneNumber) {
      setError('電話番号を入力してください');
      return;
    }

    setSendingSms(true);
    setError('');

    try {
      if (!recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container-mfa', {
          size: 'invisible'
        });
      }

      const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+81${phoneNumber.replace(/^0/, '')}`;
      const verificationId = await enrollSmsMfa(formattedPhone, recaptchaVerifierRef.current);
      setSmsVerificationId(verificationId);
      setSuccess('SMSを送信しました。認証コードを入力してください。');
    } catch (err) {
      console.error('SMS送信エラー:', err);
      setError('SMSの送信に失敗しました。電話番号を確認してください。');
    } finally {
      setSendingSms(false);
    }
  };

  const handleCompleteSmsEnrollment = async () => {
    if (!smsCode || smsCode.length !== 6) {
      setError('6桁の認証コードを入力してください');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await completeSmsMfaEnrollment(smsVerificationId, smsCode);
      setSuccess('SMS認証を登録しました');
      setShowSmsForm(false);
      setPhoneNumber('');
      setSmsVerificationId(null);
      setSmsCode('');
      setEnrolledFactors(getEnrolledMfaFactors());
    } catch (err) {
      console.error('SMS登録エラー:', err);
      setError('認証コードが正しくありません');
    } finally {
      setLoading(false);
    }
  };

  const handleStartTotpEnrollment = async () => {
    setLoading(true);
    setError('');

    try {
      const secret = await startTotpEnrollment();
      setTotpSecret(secret);

      // QRコード生成
      const uri = secret.generateQrCodeUrl(currentUser.email, '労務管理システム');
      const qrDataUrl = await QRCode.toDataURL(uri);
      setTotpQrCode(qrDataUrl);

      setShowTotpForm(true);
    } catch (err) {
      console.error('TOTP初期化エラー:', err);
      setError('認証アプリの設定を開始できませんでした');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteTotpEnrollment = async () => {
    if (!totpCode || totpCode.length !== 6) {
      setError('6桁の認証コードを入力してください');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await completeTotpEnrollment(totpSecret, totpCode);
      setSuccess('認証アプリを登録しました');
      setShowTotpForm(false);
      setTotpSecret(null);
      setTotpQrCode('');
      setTotpCode('');
      setEnrolledFactors(getEnrolledMfaFactors());
    } catch (err) {
      console.error('TOTP登録エラー:', err);
      setError('認証コードが正しくありません');
    } finally {
      setLoading(false);
    }
  };

  const handleUnenrollMfa = async (factorUid, displayName) => {
    if (!confirm(`${displayName}を削除しますか？`)) return;

    setLoading(true);
    setError('');

    try {
      await unenrollMfa(factorUid);
      setSuccess('2段階認証を削除しました');
      setEnrolledFactors(getEnrolledMfaFactors());
    } catch (err) {
      console.error('MFA削除エラー:', err);
      setError('削除に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setSuccess('シークレットキーをコピーしました');
  };

  const isRequired = isAdmin() && enrolledFactors.length === 0;

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* ヘッダー */}
      <div className="flex items-center space-x-4 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">2段階認証設定</h1>
          <p className="text-gray-500">アカウントのセキュリティを強化します</p>
        </div>
      </div>

      {/* 管理者向け必須警告 */}
      {isRequired && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 flex items-start space-x-3">
          <AlertCircle className="text-amber-600 flex-shrink-0 mt-0.5" size={20} />
          <div>
            <p className="font-medium text-amber-800">2段階認証の設定が必要です</p>
            <p className="text-sm text-amber-700">
              管理者アカウントはセキュリティのため、2段階認証の設定が必須です。
              SMS認証または認証アプリを設定してください。
            </p>
          </div>
        </div>
      )}

      {/* エラー・成功メッセージ */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-start space-x-3">
          <AlertCircle className="flex-shrink-0 mt-0.5" size={18} />
          <span className="text-sm">{error}</span>
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6 flex items-start space-x-3">
          <CheckCircle className="flex-shrink-0 mt-0.5" size={18} />
          <span className="text-sm">{success}</span>
        </div>
      )}

      {/* 登録済みMFA一覧 */}
      <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center space-x-2">
          <Shield size={20} />
          <span>登録済みの認証方法</span>
        </h2>

        {enrolledFactors.length === 0 ? (
          <p className="text-gray-500 text-center py-4">
            2段階認証が設定されていません
          </p>
        ) : (
          <div className="space-y-3">
            {enrolledFactors.map((factor) => (
              <div
                key={factor.uid}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center space-x-3">
                  {factor.factorId === 'phone' ? (
                    <Smartphone className="text-blue-600" size={20} />
                  ) : (
                    <Key className="text-green-600" size={20} />
                  )}
                  <div>
                    <p className="font-medium text-gray-800">
                      {factor.factorId === 'phone' ? 'SMS認証' : '認証アプリ'}
                    </p>
                    <p className="text-sm text-gray-500">
                      {factor.displayName || (factor.factorId === 'phone' ? factor.phoneNumber : 'TOTP')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleUnenrollMfa(factor.uid, factor.displayName || '2段階認証')}
                  disabled={loading || (isAdmin() && enrolledFactors.length === 1)}
                  className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={isAdmin() && enrolledFactors.length === 1 ? '管理者は最低1つの2段階認証が必要です' : '削除'}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 新規登録ボタン */}
      {!showSmsForm && !showTotpForm && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <button
            onClick={() => setShowSmsForm(true)}
            disabled={loading}
            className="flex items-center justify-center space-x-2 p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors disabled:opacity-50"
          >
            <Smartphone className="text-blue-600" size={24} />
            <span className="font-medium text-gray-700">SMS認証を追加</span>
          </button>
          <button
            onClick={handleStartTotpEnrollment}
            disabled={loading}
            className="flex items-center justify-center space-x-2 p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-green-500 hover:bg-green-50 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="animate-spin" size={24} />
            ) : (
              <Key className="text-green-600" size={24} />
            )}
            <span className="font-medium text-gray-700">認証アプリを追加</span>
          </button>
        </div>
      )}

      {/* SMS登録フォーム */}
      {showSmsForm && (
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center space-x-2">
            <Smartphone className="text-blue-600" size={20} />
            <span>SMS認証の設定</span>
          </h3>

          {!smsVerificationId ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  電話番号
                </label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="090-1234-5678"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  日本の電話番号を入力してください（例: 090-1234-5678）
                </p>
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={handleSendSmsCode}
                  disabled={sendingSms || !phoneNumber}
                  className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                >
                  {sendingSms ? (
                    <Loader2 className="animate-spin" size={18} />
                  ) : (
                    <span>認証コードを送信</span>
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowSmsForm(false);
                    setPhoneNumber('');
                  }}
                  className="px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  キャンセル
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  認証コード
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={smsCode}
                  onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-xl tracking-widest text-center"
                />
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={handleCompleteSmsEnrollment}
                  disabled={loading || smsCode.length !== 6}
                  className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? <Loader2 className="animate-spin mx-auto" size={18} /> : '登録'}
                </button>
                <button
                  onClick={() => {
                    setShowSmsForm(false);
                    setSmsVerificationId(null);
                    setSmsCode('');
                  }}
                  className="px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}

          <div id="recaptcha-container-mfa" ref={recaptchaContainerRef}></div>
        </div>
      )}

      {/* TOTP登録フォーム */}
      {showTotpForm && totpSecret && (
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center space-x-2">
            <Key className="text-green-600" size={20} />
            <span>認証アプリの設定</span>
          </h3>

          <div className="space-y-4">
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-4">
                Google Authenticator などの認証アプリでQRコードをスキャンしてください
              </p>
              {totpQrCode && (
                <img
                  src={totpQrCode}
                  alt="QR Code"
                  className="mx-auto w-48 h-48 border rounded-lg"
                />
              )}
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-2">
                QRコードを読み取れない場合は、以下のキーを手動で入力してください：
              </p>
              <div className="flex items-center space-x-2">
                <code className="flex-1 bg-white px-3 py-2 rounded border font-mono text-sm break-all">
                  {totpSecret.secretKey}
                </code>
                <button
                  onClick={() => copyToClipboard(totpSecret.secretKey)}
                  className="p-2 text-gray-600 hover:bg-gray-200 rounded-lg"
                  title="コピー"
                >
                  <Copy size={18} />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                認証コード
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 font-mono text-xl tracking-widest text-center"
              />
              <p className="text-xs text-gray-500 mt-1">
                認証アプリに表示されている6桁のコードを入力
              </p>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={handleCompleteTotpEnrollment}
                disabled={loading || totpCode.length !== 6}
                className="flex-1 bg-green-600 text-white py-2.5 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 className="animate-spin mx-auto" size={18} /> : '登録'}
              </button>
              <button
                onClick={() => {
                  setShowTotpForm(false);
                  setTotpSecret(null);
                  setTotpQrCode('');
                  setTotpCode('');
                }}
                className="px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 説明 */}
      <div className="bg-blue-50 rounded-lg p-4">
        <h4 className="font-medium text-blue-800 mb-2">2段階認証について</h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>・ログイン時にパスワードに加えて認証コードが必要になります</li>
          <li>・SMS認証: 登録した電話番号にコードが送信されます</li>
          <li>・認証アプリ: Google Authenticator等でコードを生成します</li>
          <li>・複数の認証方法を登録することをお勧めします</li>
        </ul>
      </div>
    </div>
  );
}
