// src/pages/settings/CompanySettings.jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import {
  Save,
  Settings,
  Building,
  CreditCard,
  AlertCircle,
  CheckCircle,
  Bell,
  Plus,
  X,
  ClipboardCheck,
  Clock,
} from 'lucide-react';

export default function CompanySettings() {
  const { companyId, isAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState('company');

  const [formData, setFormData] = useState({
    companyCode: '',
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
    invoiceNumber: '',
    retirementSystem: false,
    retirementNumber: '',
    bankInfo: {
      bankName: '',
      branchName: '',
      accountType: '',
      accountNumber: '',
      accountHolder: ''
    },
    notificationSettings: {
      enabled: false,
      reminderTimes: ['17:00']
    },
    reportDeadline: '18:00',
    approvalSettings: {
      mode: 'manual',
      autoApprovalEmails: []
    },
    attendanceSettings: {
      deductLunchBreak: true,
      lunchBreakMinutes: 60,
    }
  });

  // データ取得
  useEffect(() => {
    if (!companyId) return;

    const fetchCompany = async () => {
      try {
        const docRef = doc(db, 'companies', companyId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          setFormData({
            companyCode: data.companyCode || '',
            companyName: data.companyName || '',
            branch: data.branch || '',
            managerName: data.managerName || '',
            postalCode: data.postalCode || '',
            prefecture: data.prefecture || '',
            city: data.city || '',
            address: data.address || '',
            building: data.building || '',
            tel: data.tel || '',
            fax: data.fax || '',
            email: data.email || '',
            invoiceNumber: data.invoiceNumber || '',
            retirementSystem: data.retirementSystem || false,
            retirementNumber: data.retirementNumber || '',
            bankInfo: {
              bankName: data.bankInfo?.bankName || '',
              branchName: data.bankInfo?.branchName || '',
              accountType: data.bankInfo?.accountType || '',
              accountNumber: data.bankInfo?.accountNumber || '',
              accountHolder: data.bankInfo?.accountHolder || ''
            },
            reportDeadline: data.reportDeadline || '18:00',
            notificationSettings: {
              enabled: data.notificationSettings?.enabled || false,
              reminderTimes: data.notificationSettings?.reminderTimes || ['17:00']
            },
            approvalSettings: {
              mode: data.approvalSettings?.mode || 'manual',
              autoApprovalEmails: data.approvalSettings?.autoApprovalEmails || []
            },
            attendanceSettings: {
              deductLunchBreak: data.attendanceSettings?.deductLunchBreak !== false,
              lunchBreakMinutes: data.attendanceSettings?.lunchBreakMinutes ?? 60,
            }
          });
        }
      } catch (error) {
        console.error('データ取得エラー:', error);
        setError('データの取得に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    fetchCompany();
  }, [companyId]);

  // フォーム変更ハンドラ
  const handleChange = (field, value) => {
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      setFormData(prev => ({
        ...prev,
        [parent]: {
          ...prev[parent],
          [child]: value
        }
      }));
    } else {
      setFormData(prev => ({ ...prev, [field]: value }));
    }
  };


  // 保存処理
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.companyName.trim()) {
      setError('会社名は必須です');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const docRef = doc(db, 'companies', companyId);
      // companyCodeは自動割り当てのため保存対象から除外
      const { companyCode, ...dataToSave } = formData;
      await updateDoc(docRef, {
        ...dataToSave,
        updatedAt: serverTimestamp()
      });

      setSuccess('保存しました');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('保存エラー:', error);
      setError('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: 'company', label: '会社情報', icon: Building },
    { id: 'bank', label: '銀行情報', icon: CreditCard },
    { id: 'notification', label: '通知設定', icon: Bell },
    { id: 'approval', label: '承認設定', icon: ClipboardCheck },
    { id: 'attendance', label: '勤怠設定', icon: Clock },
  ];

  // 通知時刻の追加
  const addReminderTime = () => {
    setFormData(prev => ({
      ...prev,
      notificationSettings: {
        ...prev.notificationSettings,
        reminderTimes: [...prev.notificationSettings.reminderTimes, '18:00']
      }
    }));
  };

  // 通知時刻の削除
  const removeReminderTime = (index) => {
    setFormData(prev => ({
      ...prev,
      notificationSettings: {
        ...prev.notificationSettings,
        reminderTimes: prev.notificationSettings.reminderTimes.filter((_, i) => i !== index)
      }
    }));
  };

  // 通知時刻の更新
  const updateReminderTime = (index, value) => {
    setFormData(prev => ({
      ...prev,
      notificationSettings: {
        ...prev.notificationSettings,
        reminderTimes: prev.notificationSettings.reminderTimes.map((t, i) => i === index ? value : t)
      }
    }));
  };

  // 自動承認メールアドレスの管理
  const addApprovalEmail = () => {
    setFormData(prev => ({
      ...prev,
      approvalSettings: {
        ...prev.approvalSettings,
        autoApprovalEmails: [...prev.approvalSettings.autoApprovalEmails, '']
      }
    }));
  };

  const removeApprovalEmail = (index) => {
    setFormData(prev => ({
      ...prev,
      approvalSettings: {
        ...prev.approvalSettings,
        autoApprovalEmails: prev.approvalSettings.autoApprovalEmails.filter((_, i) => i !== index)
      }
    }));
  };

  const updateApprovalEmail = (index, value) => {
    setFormData(prev => ({
      ...prev,
      approvalSettings: {
        ...prev.approvalSettings,
        autoApprovalEmails: prev.approvalSettings.autoApprovalEmails.map((e, i) => i === index ? value : e)
      }
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center space-x-2">
          <Settings className="text-gray-500" />
          <span>自社情報設定</span>
        </h1>
        {isAdmin() && (
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            <Save size={20} />
            <span>{saving ? '保存中...' : '保存'}</span>
          </button>
        )}
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center space-x-2">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* 成功メッセージ */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center space-x-2">
          <CheckCircle size={20} />
          <span>{success}</span>
        </div>
      )}

      {/* タブ */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="border-b border-gray-200">
          <nav className="flex">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon size={18} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {/* 会社情報タブ */}
          {activeTab === 'company' && (
            <div className="space-y-6">
              {/* 企業ID */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h2 className="text-lg font-semibold text-gray-800 mb-2">企業ID</h2>
                <p className="text-sm text-gray-600 mb-4">
                  日報アプリへのログイン時に使用する8桁の企業IDです。従業員に共有してください。
                </p>
                <div className="flex items-center space-x-3">
                  <div className="px-4 py-3 bg-white border border-gray-300 rounded-lg tracking-widest text-2xl font-mono font-bold text-gray-800">
                    {formData.companyCode || '未設定'}
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  ※ 企業IDは自動で割り当てられます（変更不可）
                </p>
              </div>

              {/* 基本情報 */}
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-4">基本情報</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      会社名 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.companyName}
                      onChange={(e) => handleChange('companyName', e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">支店名</label>
                    <input
                      type="text"
                      value={formData.branch}
                      onChange={(e) => handleChange('branch', e.target.value)}
                      placeholder="本社"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">代表者名</label>
                    <input
                      type="text"
                      value={formData.managerName}
                      onChange={(e) => handleChange('managerName', e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">適格事業者番号</label>
                    <input
                      type="text"
                      value={formData.invoiceNumber}
                      onChange={(e) => handleChange('invoiceNumber', e.target.value)}
                      placeholder="T1234567890123"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              <hr />

              {/* 住所 */}
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-4">住所</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">郵便番号</label>
                    <input
                      type="text"
                      value={formData.postalCode}
                      onChange={(e) => handleChange('postalCode', e.target.value)}
                      placeholder="000-0000"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">都道府県</label>
                    <input
                      type="text"
                      value={formData.prefecture}
                      onChange={(e) => handleChange('prefecture', e.target.value)}
                      placeholder="東京都"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">市区町村</label>
                    <input
                      type="text"
                      value={formData.city}
                      onChange={(e) => handleChange('city', e.target.value)}
                      placeholder="渋谷区"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">番地号</label>
                    <input
                      type="text"
                      value={formData.address}
                      onChange={(e) => handleChange('address', e.target.value)}
                      placeholder="1-2-3"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">建物名</label>
                    <input
                      type="text"
                      value={formData.building}
                      onChange={(e) => handleChange('building', e.target.value)}
                      placeholder="サンプルビル5F"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              <hr />

              {/* 連絡先 */}
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-4">連絡先</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">TEL</label>
                    <input
                      type="tel"
                      value={formData.tel}
                      onChange={(e) => handleChange('tel', e.target.value)}
                      placeholder="03-1234-5678"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">FAX</label>
                    <input
                      type="tel"
                      value={formData.fax}
                      onChange={(e) => handleChange('fax', e.target.value)}
                      placeholder="03-1234-5679"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => handleChange('email', e.target.value)}
                      placeholder="info@example.com"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              <hr />

              {/* 退職金制度 */}
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-4">退職金制度</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex items-center">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.retirementSystem}
                        onChange={(e) => handleChange('retirementSystem', e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700">退職金制度あり</span>
                    </label>
                  </div>
                  {formData.retirementSystem && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">退職金番号</label>
                      <input
                        type="text"
                        value={formData.retirementNumber}
                        onChange={(e) => handleChange('retirementNumber', e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 銀行情報タブ */}
          {activeTab === 'bank' && (
            <div>
              <h2 className="text-lg font-semibold text-gray-800 mb-4">銀行口座情報</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">銀行名</label>
                  <input
                    type="text"
                    value={formData.bankInfo.bankName}
                    onChange={(e) => handleChange('bankInfo.bankName', e.target.value)}
                    placeholder="サンプル銀行"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">支店名</label>
                  <input
                    type="text"
                    value={formData.bankInfo.branchName}
                    onChange={(e) => handleChange('bankInfo.branchName', e.target.value)}
                    placeholder="東京支店"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">口座種類</label>
                  <select
                    value={formData.bankInfo.accountType}
                    onChange={(e) => handleChange('bankInfo.accountType', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">選択してください</option>
                    <option value="普通">普通</option>
                    <option value="当座">当座</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">口座番号</label>
                  <input
                    type="text"
                    value={formData.bankInfo.accountNumber}
                    onChange={(e) => handleChange('bankInfo.accountNumber', e.target.value)}
                    placeholder="1234567"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">口座名義人</label>
                  <input
                    type="text"
                    value={formData.bankInfo.accountHolder}
                    onChange={(e) => handleChange('bankInfo.accountHolder', e.target.value)}
                    placeholder="カ）サンプル"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 通知設定タブ */}
          {activeTab === 'notification' && (
            <div className="space-y-6">
              {/* 日報提出期限 */}
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-4">日報提出期限</h2>
                <p className="text-sm text-gray-600 mb-4">
                  日報アプリに表示される提出期限の時刻を設定します。期限を過ぎると警告が表示されます。
                </p>
                <div className="flex items-center space-x-3">
                  <input
                    type="time"
                    value={formData.reportDeadline}
                    onChange={(e) => handleChange('reportDeadline', e.target.value)}
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <span className="text-sm text-gray-500">（デフォルト: 18:00）</span>
                </div>
              </div>

              <hr />

              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-4">日報リマインダー通知</h2>
                <p className="text-sm text-gray-600 mb-4">
                  日報が未提出の場合に、指定した時刻にプッシュ通知を送信します。
                </p>

                {/* 通知ON/OFF */}
                <div className="flex items-center space-x-3 mb-6">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.notificationSettings.enabled}
                      onChange={(e) => handleChange('notificationSettings.enabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    <span className="ml-3 text-sm font-medium text-gray-700">
                      {formData.notificationSettings.enabled ? '通知ON' : '通知OFF'}
                    </span>
                  </label>
                </div>

                {/* 通知時刻設定 */}
                {formData.notificationSettings.enabled && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-sm font-medium text-gray-700 mb-3">通知時刻</h3>
                    <div className="space-y-3">
                      {formData.notificationSettings.reminderTimes.map((time, index) => (
                        <div key={index} className="flex items-center space-x-3">
                          <input
                            type="time"
                            value={time}
                            onChange={(e) => updateReminderTime(index, e.target.value)}
                            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                          {formData.notificationSettings.reminderTimes.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeReminderTime(index)}
                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <X size={18} />
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={addReminderTime}
                        className="flex items-center space-x-2 text-blue-600 hover:text-blue-800 text-sm"
                      >
                        <Plus size={16} />
                        <span>時刻を追加</span>
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-3">
                      ※ 指定した各時刻に、日報未提出者へプッシュ通知が送信されます
                    </p>
                  </div>
                )}
              </div>

              <hr />

              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-4">カスタム通知</h2>
                <p className="text-sm text-gray-600 mb-4">
                  任意のメッセージを指定した時刻に通知できます。現場ごとの個別設定も可能です。
                </p>
                <a
                  href="/settings/notifications"
                  className="inline-flex items-center space-x-2 text-blue-600 hover:text-blue-800"
                >
                  <Bell size={18} />
                  <span>カスタム通知の設定へ</span>
                </a>
              </div>
            </div>
          )}

          {/* 承認設定タブ */}
          {activeTab === 'approval' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-4">日報承認設定</h2>
                <p className="text-sm text-gray-600 mb-4">
                  日報送信後の承認フローを設定します。現場ごとに個別設定も可能です（現場マスタで設定）。
                </p>

                <div className="space-y-3">
                  <label className={`flex items-start space-x-3 p-4 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors ${formData.approvalSettings.mode === 'manual' ? 'border-blue-500 bg-blue-50' : ''}`}>
                    <input
                      type="radio"
                      name="approvalMode"
                      value="manual"
                      checked={formData.approvalSettings.mode === 'manual'}
                      onChange={() => handleChange('approvalSettings.mode', 'manual')}
                      className="mt-1 text-blue-600"
                    />
                    <div>
                      <span className="font-medium text-gray-900">手動承認</span>
                      <p className="text-sm text-gray-500 mt-1">日報送信後、管理画面で承認・差戻しを行います。</p>
                    </div>
                  </label>
                  <label className={`flex items-start space-x-3 p-4 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors ${formData.approvalSettings.mode === 'auto' ? 'border-blue-500 bg-blue-50' : ''}`}>
                    <input
                      type="radio"
                      name="approvalMode"
                      value="auto"
                      checked={formData.approvalSettings.mode === 'auto'}
                      onChange={() => handleChange('approvalSettings.mode', 'auto')}
                      className="mt-1 text-blue-600"
                    />
                    <div>
                      <span className="font-medium text-gray-900">自動承認</span>
                      <p className="text-sm text-gray-500 mt-1">日報送信と同時に自動承認し、PDFをメールで送信します。</p>
                    </div>
                  </label>
                </div>
              </div>

              {formData.approvalSettings.mode === 'auto' && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">PDF送信先メールアドレス</h3>
                  <p className="text-xs text-gray-500 mb-3">
                    自動承認時に日報PDFが送信されるメールアドレスを設定します。複数登録可能です。
                  </p>
                  <div className="space-y-3">
                    {formData.approvalSettings.autoApprovalEmails.map((email, index) => (
                      <div key={index} className="flex items-center space-x-3">
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => updateApprovalEmail(index, e.target.value)}
                          placeholder="example@example.com"
                          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => removeApprovalEmail(index)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addApprovalEmail}
                      className="flex items-center space-x-2 text-blue-600 hover:text-blue-800 text-sm"
                    >
                      <Plus size={16} />
                      <span>メールアドレスを追加</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-sm">
                <strong>ヒント:</strong> 現場ごとに承認フローを変更する場合は、現場マスタの各現場詳細画面で個別に設定できます。
              </div>
            </div>
          )}

          {/* 勤怠設定タブ */}
          {activeTab === 'attendance' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-4">昼休憩の控除設定</h2>
                <p className="text-sm text-gray-600 mb-4">
                  勤怠集計で稼働時間を計算する際に、昼休憩の時間を控除するかどうかを設定します。
                </p>

                <div className="space-y-3">
                  <label className={`flex items-start space-x-3 p-4 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors ${formData.attendanceSettings.deductLunchBreak ? 'border-blue-500 bg-blue-50' : ''}`}>
                    <input
                      type="radio"
                      name="deductLunchBreak"
                      checked={formData.attendanceSettings.deductLunchBreak}
                      onChange={() => setFormData(prev => ({
                        ...prev,
                        attendanceSettings: { ...prev.attendanceSettings, deductLunchBreak: true }
                      }))}
                      className="mt-1 text-blue-600"
                    />
                    <div>
                      <span className="font-medium text-gray-900">昼休憩を稼働時間から控除する</span>
                      <p className="text-sm text-gray-500 mt-1">
                        昼休憩ありの場合、設定した休憩時間を差し引いて稼働時間を計算します。
                      </p>
                    </div>
                  </label>
                  <label className={`flex items-start space-x-3 p-4 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors ${!formData.attendanceSettings.deductLunchBreak ? 'border-blue-500 bg-blue-50' : ''}`}>
                    <input
                      type="radio"
                      name="deductLunchBreak"
                      checked={!formData.attendanceSettings.deductLunchBreak}
                      onChange={() => setFormData(prev => ({
                        ...prev,
                        attendanceSettings: { ...prev.attendanceSettings, deductLunchBreak: false }
                      }))}
                      className="mt-1 text-blue-600"
                    />
                    <div>
                      <span className="font-medium text-gray-900">昼休憩を稼働時間に含む</span>
                      <p className="text-sm text-gray-500 mt-1">
                        昼休憩の有無に関わらず、開始〜終了の全時間を稼働時間として計算します。
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {formData.attendanceSettings.deductLunchBreak && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">昼休憩の控除時間</h3>
                  <div className="flex items-center space-x-3">
                    <select
                      value={formData.attendanceSettings.lunchBreakMinutes}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        attendanceSettings: { ...prev.attendanceSettings, lunchBreakMinutes: Number(e.target.value) }
                      }))}
                      className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value={30}>30分</option>
                      <option value={45}>45分</option>
                      <option value={60}>60分（1時間）</option>
                      <option value={90}>90分（1.5時間）</option>
                    </select>
                    <span className="text-sm text-gray-500">（デフォルト: 60分）</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-3">
                    ※ 「昼休憩なし」にチェックが入っている作業員は、この設定に関わらず控除されません。
                  </p>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-sm">
                <strong>計算例:</strong> 開始 8:00、終了 17:00 の場合
                <br />
                {formData.attendanceSettings.deductLunchBreak
                  ? `→ 昼休憩あり: ${9 - formData.attendanceSettings.lunchBreakMinutes / 60}時間 / 昼休憩なし: 9時間`
                  : '→ 昼休憩の有無に関わらず: 9時間'}
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
