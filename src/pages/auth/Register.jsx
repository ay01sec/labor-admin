import { useState } from 'react';
import { Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../services/firebase';
import {
  Building,
  UserPlus,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  Copy,
  Eye,
  EyeOff,
  Loader2
} from 'lucide-react';

const STEPS = [
  { id: 1, label: '会社情報', icon: Building },
  { id: 2, label: '管理者ユーザー', icon: UserPlus },
  { id: 3, label: '登録完了', icon: CheckCircle },
];

export default function Register() {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [companyCode, setCompanyCode] = useState('');
  const [copied, setCopied] = useState(false);

  const [companyData, setCompanyData] = useState({
    companyName: '',
    branch: '',
    managerName: '',
    postalCode: '',
    prefecture: '',
    city: '',
    address: '',
    building: '',
    tel: '',
    fax: '',
    email: '',
  });

  const [userData, setUserData] = useState({
    email: '',
    displayName: '',
    password: '',
    passwordConfirm: '',
  });

  const handleCompanyChange = (field, value) => {
    setCompanyData(prev => ({ ...prev, [field]: value }));
  };

  const handleUserChange = (field, value) => {
    setUserData(prev => ({ ...prev, [field]: value }));
  };

  // ステップ1バリデーション
  const validateStep1 = () => {
    if (!companyData.companyName.trim()) {
      setError('会社名は必須です');
      return false;
    }
    setError('');
    return true;
  };

  // ステップ2バリデーション
  const validateStep2 = () => {
    if (!userData.email.trim()) {
      setError('メールアドレスは必須です');
      return false;
    }
    if (!userData.displayName.trim()) {
      setError('表示名は必須です');
      return false;
    }
    if (userData.password.length < 6) {
      setError('パスワードは6文字以上で入力してください');
      return false;
    }
    if (userData.password !== userData.passwordConfirm) {
      setError('パスワードが一致しません');
      return false;
    }
    setError('');
    return true;
  };

  const handleNext = () => {
    if (currentStep === 1 && validateStep1()) {
      setCurrentStep(2);
    }
  };

  const handleBack = () => {
    setError('');
    setCurrentStep(prev => prev - 1);
  };

  // 登録処理
  const handleSubmit = async () => {
    if (!validateStep2()) return;

    setLoading(true);
    setError('');

    try {
      const registerCompany = httpsCallable(functions, 'registerCompany');
      const result = await registerCompany({
        company: companyData,
        user: {
          email: userData.email,
          displayName: userData.displayName,
          password: userData.password,
        },
      });

      setCompanyCode(result.data.companyCode);
      setCurrentStep(3);
    } catch (err) {
      console.error('登録エラー:', err);
      const message = err.message || '登録に失敗しました。しばらくしてから再度お試しください。';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(companyCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const el = document.createElement('textarea');
      el.value = companyCode;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* ヘッダー */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-800">労務管理システム</h1>
          <p className="text-gray-500 mt-1">新規利用開始手続き</p>
        </div>

        {/* ステッパー */}
        <div className="flex items-center justify-center mb-8">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            const isActive = currentStep === step.id;
            const isCompleted = currentStep > step.id;
            return (
              <div key={step.id} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                    isCompleted ? 'bg-green-500 text-white'
                    : isActive ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-400'
                  }`}>
                    {isCompleted ? <CheckCircle size={20} /> : <Icon size={20} />}
                  </div>
                  <span className={`text-xs mt-1.5 ${
                    isActive ? 'text-blue-600 font-medium' : 'text-gray-400'
                  }`}>
                    {step.label}
                  </span>
                </div>
                {index < STEPS.length - 1 && (
                  <div className={`w-16 h-0.5 mx-2 mb-5 ${
                    currentStep > step.id ? 'bg-green-500' : 'bg-gray-200'
                  }`} />
                )}
              </div>
            );
          })}
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center space-x-2 mb-4">
            <AlertCircle size={20} className="flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* フォーム */}
        <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8">

          {/* ステップ1: 会社情報 */}
          {currentStep === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-1">会社情報の登録</h2>
                <p className="text-sm text-gray-500">基本的な会社情報を入力してください</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  会社名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={companyData.companyName}
                  onChange={(e) => handleCompanyChange('companyName', e.target.value)}
                  placeholder="株式会社サンプル"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">支店名</label>
                  <input
                    type="text"
                    value={companyData.branch}
                    onChange={(e) => handleCompanyChange('branch', e.target.value)}
                    placeholder="本社"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">代表者名</label>
                  <input
                    type="text"
                    value={companyData.managerName}
                    onChange={(e) => handleCompanyChange('managerName', e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <hr />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">郵便番号</label>
                  <input
                    type="text"
                    value={companyData.postalCode}
                    onChange={(e) => handleCompanyChange('postalCode', e.target.value)}
                    placeholder="000-0000"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">都道府県</label>
                  <input
                    type="text"
                    value={companyData.prefecture}
                    onChange={(e) => handleCompanyChange('prefecture', e.target.value)}
                    placeholder="東京都"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">市区町村</label>
                  <input
                    type="text"
                    value={companyData.city}
                    onChange={(e) => handleCompanyChange('city', e.target.value)}
                    placeholder="渋谷区"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">番地号</label>
                  <input
                    type="text"
                    value={companyData.address}
                    onChange={(e) => handleCompanyChange('address', e.target.value)}
                    placeholder="1-2-3"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">建物名</label>
                <input
                  type="text"
                  value={companyData.building}
                  onChange={(e) => handleCompanyChange('building', e.target.value)}
                  placeholder="サンプルビル5F"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <hr />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">TEL</label>
                  <input
                    type="tel"
                    value={companyData.tel}
                    onChange={(e) => handleCompanyChange('tel', e.target.value)}
                    placeholder="03-1234-5678"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">FAX</label>
                  <input
                    type="tel"
                    value={companyData.fax}
                    onChange={(e) => handleCompanyChange('fax', e.target.value)}
                    placeholder="03-1234-5679"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={companyData.email}
                  onChange={(e) => handleCompanyChange('email', e.target.value)}
                  placeholder="info@example.com"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="flex justify-between pt-2">
                <Link
                  to="/login"
                  className="text-sm text-gray-500 hover:text-gray-700 flex items-center space-x-1"
                >
                  <ArrowLeft size={16} />
                  <span>ログインへ戻る</span>
                </Link>
                <button
                  onClick={handleNext}
                  className="inline-flex items-center space-x-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <span>次へ</span>
                  <ArrowRight size={18} />
                </button>
              </div>
            </div>
          )}

          {/* ステップ2: 管理者ユーザー */}
          {currentStep === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-1">管理者ユーザーの登録</h2>
                <p className="text-sm text-gray-500">ログインに使用するアカウント情報を設定してください</p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                ここで設定するメールアドレスとパスワードは、今後のログイン時に使用します。大切に管理してください。
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  メールアドレス <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={userData.email}
                  onChange={(e) => handleUserChange('email', e.target.value)}
                  placeholder="admin@example.com"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  表示名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={userData.displayName}
                  onChange={(e) => handleUserChange('displayName', e.target.value)}
                  placeholder="管理者名"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  パスワード <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={userData.password}
                    onChange={(e) => handleUserChange('password', e.target.value)}
                    placeholder="6文字以上"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  パスワード確認 <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={userData.passwordConfirm}
                  onChange={(e) => handleUserChange('passwordConfirm', e.target.value)}
                  placeholder="もう一度パスワードを入力"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="flex justify-between pt-2">
                <button
                  onClick={handleBack}
                  className="text-sm text-gray-500 hover:text-gray-700 flex items-center space-x-1"
                >
                  <ArrowLeft size={16} />
                  <span>戻る</span>
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="inline-flex items-center space-x-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      <span>登録中...</span>
                    </>
                  ) : (
                    <>
                      <span>登録する</span>
                      <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ステップ3: 登録完了 */}
          {currentStep === 3 && (
            <div className="space-y-6 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle size={32} className="text-green-600" />
              </div>

              <div>
                <h2 className="text-xl font-bold text-gray-800 mb-2">登録が完了しました</h2>
                <p className="text-sm text-gray-500">以下の企業IDでログインできます</p>
              </div>

              <div className="bg-gray-50 rounded-xl p-6">
                <p className="text-sm text-gray-500 mb-2">企業ID</p>
                <div className="flex items-center justify-center space-x-3">
                  <span className="text-3xl font-mono font-bold text-gray-800 tracking-widest">
                    {companyCode}
                  </span>
                  <button
                    onClick={handleCopy}
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="コピー"
                  >
                    <Copy size={20} />
                  </button>
                </div>
                {copied && (
                  <p className="text-green-600 text-sm mt-2">コピーしました</p>
                )}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800 text-left">
                <p className="font-medium mb-2">ログイン方法</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>上記の企業ID（8桁の数字）を入力</li>
                  <li>登録したメールアドレスを入力</li>
                  <li>登録したパスワードを入力</li>
                  <li>「ログイン」をクリック</li>
                </ol>
              </div>

              <p className="text-sm text-gray-500">
                登録したメールアドレスにログイン情報の詳細を送信しました
              </p>

              <Link
                to="/login"
                className="inline-flex items-center space-x-2 bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition-colors text-base"
              >
                <span>ログインへ進む</span>
                <ArrowRight size={20} />
              </Link>
            </div>
          )}
        </div>

        {/* フッター */}
        <p className="text-center text-xs text-gray-400 mt-6">
          &copy; 2026 労務管理システム
        </p>
      </div>
    </div>
  );
}
