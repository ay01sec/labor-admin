// src/pages/settings/CompanySettings.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp
} from 'firebase/firestore';
import { db, functions, storage } from '../../services/firebase';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
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
  Users,
  Trash2,
  ChevronUp,
  ChevronDown,
  FileText,
  Loader2,
  Image,
  Upload,
} from 'lucide-react';
import { DEFAULT_EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_COLORS } from '../../constants/employmentTypes';

// PAY.JP公開キー
const PAYJP_PUBLIC_KEY = import.meta.env.VITE_PAYJP_PUBLIC_KEY;

// カードブランドの表示名
const CARD_BRAND_LABELS = {
  'Visa': 'Visa',
  'MasterCard': 'Mastercard',
  'American Express': 'American Express',
  'Discover': 'Discover',
  'Diners Club': 'Diners Club',
  'JCB': 'JCB',
};

// PAY.JP カード入力コンポーネント（3Dセキュア対応）
function PayjpCardForm({ companyId, onSuccess, onError }) {
  const cardNumberRef = useRef(null);
  const cardExpiryRef = useRef(null);
  const cardCvcRef = useRef(null);
  const payjpRef = useRef(null);
  const cardNumberElementRef = useRef(null);
  const [processing, setProcessing] = useState(false);
  const [cardError, setCardError] = useState('');
  const [ready, setReady] = useState(false);
  // 3Dセキュア用の追加フィールド
  const [cardName, setCardName] = useState('');
  const [cardEmail, setCardEmail] = useState('');

  useEffect(() => {
    if (!PAYJP_PUBLIC_KEY || !window.Payjp) return;

    // 3Dセキュア対応: iframe ワークフローを指定
    const payjp = window.Payjp(PAYJP_PUBLIC_KEY, {
      threeDSecureWorkflow: 'iframe'
    });
    payjpRef.current = payjp;
    const elements = payjp.elements();

    const style = {
      base: {
        color: '#32325d',
        fontSize: '16px',
        '::placeholder': { color: '#aab7c4' },
      },
      invalid: { color: '#e25950' },
    };

    const cardNumber = elements.create('cardNumber', { style });
    const cardExpiry = elements.create('cardExpiry', { style });
    const cardCvc = elements.create('cardCvc', { style });

    cardNumber.mount(cardNumberRef.current);
    cardExpiry.mount(cardExpiryRef.current);
    cardCvc.mount(cardCvcRef.current);

    cardNumberElementRef.current = cardNumber;
    setReady(true);

    cardNumber.on('change', (event) => {
      if (event.error) setCardError(event.error.message);
      else setCardError('');
    });

    return () => {
      cardNumber.unmount();
      cardExpiry.unmount();
      cardCvc.unmount();
    };
  }, []);

  const handleCardSubmit = async () => {
    if (!payjpRef.current || !cardNumberElementRef.current) return;

    // 3Dセキュア用のバリデーション
    if (!cardName.trim()) {
      setCardError('カード名義を入力してください');
      return;
    }
    if (!cardEmail.trim()) {
      setCardError('メールアドレスを入力してください');
      return;
    }

    setProcessing(true);
    setCardError('');

    try {
      // 1. PAY.JPトークン作成（3Dセキュア認証付き）
      const response = await payjpRef.current.createToken(cardNumberElementRef.current, {
        three_d_secure: true,
        card: {
          name: cardName.trim(),
          email: cardEmail.trim(),
        },
      });

      if (response.error) {
        setCardError(response.error.message);
        return;
      }

      // 2. バックエンドでカード登録
      const registerCard = httpsCallable(functions, 'registerCard');
      const result = await registerCard({
        companyId,
        tokenId: response.id,
      });

      onSuccess(result.data);
    } catch (err) {
      console.error('カード登録エラー:', err);
      setCardError(err.message || 'カード登録に失敗しました');
      onError?.(err);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 3Dセキュア用: カード名義 */}
      <div>
        <label className="block text-sm font-medium text-gray-600 mb-1">
          カード名義 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={cardName}
          onChange={(e) => setCardName(e.target.value.toUpperCase())}
          placeholder="TARO YAMADA"
          className="w-full border border-gray-300 rounded-lg p-3 bg-white text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <p className="text-xs text-gray-500 mt-1">カードに記載されている名義を半角英字で入力</p>
      </div>
      {/* 3Dセキュア用: メールアドレス */}
      <div>
        <label className="block text-sm font-medium text-gray-600 mb-1">
          メールアドレス <span className="text-red-500">*</span>
        </label>
        <input
          type="email"
          value={cardEmail}
          onChange={(e) => setCardEmail(e.target.value)}
          placeholder="example@email.com"
          className="w-full border border-gray-300 rounded-lg p-3 bg-white text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <p className="text-xs text-gray-500 mt-1">3Dセキュア認証に使用します</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-600 mb-1">カード番号</label>
        <div ref={cardNumberRef} className="border border-gray-300 rounded-lg p-3 bg-white" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">有効期限</label>
          <div ref={cardExpiryRef} className="border border-gray-300 rounded-lg p-3 bg-white" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">CVC</label>
          <div ref={cardCvcRef} className="border border-gray-300 rounded-lg p-3 bg-white" />
        </div>
      </div>
      {cardError && (
        <p className="text-sm text-red-600">{cardError}</p>
      )}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-xs text-blue-700">
          <strong>3Dセキュア認証について:</strong> カード登録時に本人認証（3Dセキュア）が行われます。
          カード発行会社の認証画面が表示される場合があります。
        </p>
      </div>
      <button
        type="button"
        onClick={handleCardSubmit}
        disabled={!ready || processing}
        className="inline-flex items-center space-x-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {processing ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            <span>認証中...</span>
          </>
        ) : (
          <>
            <CreditCard size={18} />
            <span>カードを登録</span>
          </>
        )}
      </button>
    </div>
  );
}

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
    },
    employmentTypes: DEFAULT_EMPLOYMENT_TYPES,
    allowReportDeletion: false
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
            },
            employmentTypes: data.employmentTypes?.length > 0 ? data.employmentTypes : DEFAULT_EMPLOYMENT_TYPES,
            allowReportDeletion: data.allowReportDeletion || false
          });
          // 画像データの取得
          setImages({
            logoImage: data.logoImage || null,
            companySealImage: data.companySealImage || null,
            squareSealImage: data.squareSealImage || null
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

  // 画像アップロードハンドラ
  const handleImageUpload = async (imageType, file) => {
    if (!file) return;

    // ファイルサイズチェック（2MB制限）
    if (file.size > 2 * 1024 * 1024) {
      setError('ファイルサイズは2MB以下にしてください');
      return;
    }

    // ファイル形式チェック
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setError('JPG、PNG、GIF、WEBP形式の画像のみアップロードできます');
      return;
    }

    setImageUploading(prev => ({ ...prev, [imageType]: true }));
    setError('');

    try {
      // ファイル名を生成（タイムスタンプ付き）
      const ext = file.name.split('.').pop();
      const fileName = `${imageType}_${Date.now()}.${ext}`;
      const storageRef = ref(storage, `companies/${companyId}/images/${fileName}`);

      // 古い画像があれば削除
      if (images[imageType]) {
        try {
          const oldRef = ref(storage, images[imageType]);
          await deleteObject(oldRef);
        } catch (e) {
          // 古い画像が存在しない場合は無視
          console.log('Old image not found, skipping delete');
        }
      }

      // 新しい画像をアップロード
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);

      // Firestoreに保存
      const docRef = doc(db, 'companies', companyId);
      await updateDoc(docRef, {
        [imageType]: downloadUrl,
        updatedAt: serverTimestamp()
      });

      // state更新
      setImages(prev => ({ ...prev, [imageType]: downloadUrl }));
      setSuccess('画像をアップロードしました');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('画像アップロードエラー:', error);
      setError('画像のアップロードに失敗しました');
    } finally {
      setImageUploading(prev => ({ ...prev, [imageType]: false }));
    }
  };

  // 画像削除ハンドラ
  const handleImageDelete = async (imageType) => {
    if (!images[imageType]) return;

    setImageUploading(prev => ({ ...prev, [imageType]: true }));
    setError('');

    try {
      // Storageから削除
      try {
        const imageRef = ref(storage, images[imageType]);
        await deleteObject(imageRef);
      } catch (e) {
        console.log('Image not found in storage, skipping delete');
      }

      // FirestoreからURLを削除
      const docRef = doc(db, 'companies', companyId);
      await updateDoc(docRef, {
        [imageType]: null,
        updatedAt: serverTimestamp()
      });

      // state更新
      setImages(prev => ({ ...prev, [imageType]: null }));
      setSuccess('画像を削除しました');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('画像削除エラー:', error);
      setError('画像の削除に失敗しました');
    } finally {
      setImageUploading(prev => ({ ...prev, [imageType]: false }));
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

  // 決済情報の状態
  const [billing, setBilling] = useState(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('card');
  const [invoiceForm, setInvoiceForm] = useState({
    contactName: '',
    billingAddress: '',
    note: '',
  });
  const [invoiceSubmitting, setInvoiceSubmitting] = useState(false);

  // 解約モーダル
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelConfirmName, setCancelConfirmName] = useState('');
  const [canceling, setCanceling] = useState(false);

  // 画像設定
  const [images, setImages] = useState({
    logoImage: null,
    companySealImage: null,
    squareSealImage: null
  });
  const [imageUploading, setImageUploading] = useState({
    logoImage: false,
    companySealImage: false,
    squareSealImage: false
  });

  // billing情報の取得
  const fetchBilling = useCallback(async () => {
    if (!companyId) return;
    try {
      const docRef = doc(db, 'companies', companyId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        setBilling(data.billing || null);
        if (data.billing?.invoiceRequest) {
          setInvoiceForm({
            contactName: data.billing.invoiceRequest.contactName || '',
            billingAddress: data.billing.invoiceRequest.billingAddress || '',
            note: data.billing.invoiceRequest.note || '',
          });
        }
        if (data.billing?.paymentMethod) {
          setSelectedPaymentMethod(data.billing.paymentMethod);
        }
      }
    } catch (err) {
      console.error('billing取得エラー:', err);
    }
  }, [companyId]);

  useEffect(() => {
    fetchBilling();
  }, [fetchBilling]);

  // 請求書払い申請
  const handleInvoiceSubmit = async () => {
    if (!invoiceForm.contactName.trim()) {
      setError('担当者名は必須です');
      return;
    }

    setInvoiceSubmitting(true);
    setError('');

    try {
      const requestInvoicePayment = httpsCallable(functions, 'requestInvoicePayment');
      await requestInvoicePayment({
        companyId,
        invoiceRequest: invoiceForm,
      });
      setSuccess('請求書払いの申請が完了しました');
      setTimeout(() => setSuccess(''), 3000);
      await fetchBilling();
    } catch (err) {
      console.error('請求書払い申請エラー:', err);
      setError(err.message || '請求書払いの申請に失敗しました');
    } finally {
      setInvoiceSubmitting(false);
    }
  };

  // カード登録成功時
  const handleCardSuccess = async () => {
    setSuccess('クレジットカードを登録しました');
    setTimeout(() => setSuccess(''), 3000);
    await fetchBilling();
  };

  // 解約処理
  const handleCancelCompany = async () => {
    if (cancelConfirmName !== formData.companyName) return;

    setCanceling(true);
    setError('');

    try {
      const cancelCompany = httpsCallable(functions, 'cancelCompany');
      await cancelCompany({ companyId });
      setShowCancelModal(false);
      // companyInfoを再取得して解約済み画面を表示させる
      window.location.reload();
    } catch (err) {
      console.error('解約エラー:', err);
      setError(err.message || '解約処理に失敗しました');
    } finally {
      setCanceling(false);
    }
  };

  const tabs = [
    { id: 'company', label: '会社情報', icon: Building },
    { id: 'bank', label: '銀行情報', icon: CreditCard },
    { id: 'billing', label: '決済情報', icon: FileText },
    { id: 'notification', label: '通知設定', icon: Bell },
    { id: 'approval', label: '承認設定', icon: ClipboardCheck },
    { id: 'attendance', label: '勤怠設定', icon: Clock },
    { id: 'employmentType', label: '雇用形態', icon: Users },
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

  // 雇用形態の追加
  const addEmploymentType = () => {
    const newId = `custom_${Date.now()}`;
    setFormData(prev => ({
      ...prev,
      employmentTypes: [...prev.employmentTypes, {
        id: newId,
        label: '新しい雇用形態',
        color: 'gray',
        isDefault: false
      }]
    }));
  };

  // 雇用形態の削除
  const removeEmploymentType = (index) => {
    setFormData(prev => ({
      ...prev,
      employmentTypes: prev.employmentTypes.filter((_, i) => i !== index)
    }));
  };

  // 雇用形態の更新
  const updateEmploymentType = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      employmentTypes: prev.employmentTypes.map((type, i) =>
        i === index ? { ...type, [field]: value } : type
      )
    }));
  };

  // 雇用形態の並び替え（上へ）
  const moveEmploymentTypeUp = (index) => {
    if (index === 0) return;
    setFormData(prev => {
      const types = [...prev.employmentTypes];
      [types[index - 1], types[index]] = [types[index], types[index - 1]];
      return { ...prev, employmentTypes: types };
    });
  };

  // 雇用形態の並び替え（下へ）
  const moveEmploymentTypeDown = (index) => {
    setFormData(prev => {
      if (index === prev.employmentTypes.length - 1) return prev;
      const types = [...prev.employmentTypes];
      [types[index], types[index + 1]] = [types[index + 1], types[index]];
      return { ...prev, employmentTypes: types };
    });
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
        {/* 銀行情報・決済情報タブは管理者のみ保存可能 */}
        {(activeTab !== 'bank' && activeTab !== 'billing') || isAdmin() ? (
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            <Save size={20} />
            <span>{saving ? '保存中...' : '保存'}</span>
          </button>
        ) : null}
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
          <nav className="flex overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 px-4 py-3 sm:px-6 sm:py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
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
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
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
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                          />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">代表者名</label>
                    <input
                      type="text"
                      value={formData.managerName}
                      onChange={(e) => handleChange('managerName', e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                          />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">適格事業者番号</label>
                    <input
                      type="text"
                      value={formData.invoiceNumber}
                      onChange={(e) => handleChange('invoiceNumber', e.target.value)}
                      placeholder="T1234567890123"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
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
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                          />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">都道府県</label>
                    <input
                      type="text"
                      value={formData.prefecture}
                      onChange={(e) => handleChange('prefecture', e.target.value)}
                      placeholder="東京都"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                          />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">市区町村</label>
                    <input
                      type="text"
                      value={formData.city}
                      onChange={(e) => handleChange('city', e.target.value)}
                      placeholder="渋谷区"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                          />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">番地号</label>
                    <input
                      type="text"
                      value={formData.address}
                      onChange={(e) => handleChange('address', e.target.value)}
                      placeholder="1-2-3"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                          />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">建物名</label>
                    <input
                      type="text"
                      value={formData.building}
                      onChange={(e) => handleChange('building', e.target.value)}
                      placeholder="サンプルビル5F"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
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
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                          />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">FAX</label>
                    <input
                      type="tel"
                      value={formData.fax}
                      onChange={(e) => handleChange('fax', e.target.value)}
                      placeholder="03-1234-5679"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                          />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => handleChange('email', e.target.value)}
                      placeholder="info@example.com"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                          />
                  </div>
                </div>
              </div>

              <hr />

              {/* 画像設定 */}
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-4">画像設定</h2>
                <p className="text-sm text-gray-600 mb-4">
                  PDF書類などに使用するロゴや印鑑の画像を設定できます。
                  {!isAdmin() && <span className="text-yellow-600 ml-2">（管理者のみ変更可能）</span>}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* ロゴ画像 */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      ロゴ画像
                    </label>
                    <div className="flex flex-col items-center">
                      {images.logoImage ? (
                        <div className="relative mb-3">
                          <img
                            src={images.logoImage}
                            alt="ロゴ"
                            className="w-32 h-32 object-contain border border-gray-300 rounded-lg bg-white"
                          />
                          {isAdmin() && (
                            <button
                              type="button"
                              onClick={() => handleImageDelete('logoImage')}
                              disabled={imageUploading.logoImage}
                              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 transition-colors disabled:opacity-50"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="w-32 h-32 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center mb-3 bg-white">
                          <Image size={32} className="text-gray-400" />
                        </div>
                      )}
                      {isAdmin() && (
                        <label className="cursor-pointer">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp"
                            className="hidden"
                            onChange={(e) => handleImageUpload('logoImage', e.target.files[0])}
                            disabled={imageUploading.logoImage}
                          />
                          <span className={`inline-flex items-center space-x-1 text-sm px-3 py-1.5 rounded-lg transition-colors ${
                            imageUploading.logoImage
                              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                              : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                          }`}>
                            {imageUploading.logoImage ? (
                              <>
                                <Loader2 size={14} className="animate-spin" />
                                <span>アップロード中...</span>
                              </>
                            ) : (
                              <>
                                <Upload size={14} />
                                <span>画像を選択</span>
                              </>
                            )}
                          </span>
                        </label>
                      )}
                    </div>
                  </div>

                  {/* 社印画像 */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      社印（丸印）
                    </label>
                    <div className="flex flex-col items-center">
                      {images.companySealImage ? (
                        <div className="relative mb-3">
                          <img
                            src={images.companySealImage}
                            alt="社印"
                            className="w-32 h-32 object-contain border border-gray-300 rounded-lg bg-white"
                          />
                          {isAdmin() && (
                            <button
                              type="button"
                              onClick={() => handleImageDelete('companySealImage')}
                              disabled={imageUploading.companySealImage}
                              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 transition-colors disabled:opacity-50"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="w-32 h-32 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center mb-3 bg-white">
                          <Image size={32} className="text-gray-400" />
                        </div>
                      )}
                      {isAdmin() && (
                        <label className="cursor-pointer">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp"
                            className="hidden"
                            onChange={(e) => handleImageUpload('companySealImage', e.target.files[0])}
                            disabled={imageUploading.companySealImage}
                          />
                          <span className={`inline-flex items-center space-x-1 text-sm px-3 py-1.5 rounded-lg transition-colors ${
                            imageUploading.companySealImage
                              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                              : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                          }`}>
                            {imageUploading.companySealImage ? (
                              <>
                                <Loader2 size={14} className="animate-spin" />
                                <span>アップロード中...</span>
                              </>
                            ) : (
                              <>
                                <Upload size={14} />
                                <span>画像を選択</span>
                              </>
                            )}
                          </span>
                        </label>
                      )}
                    </div>
                  </div>

                  {/* 角印画像 */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      角印
                    </label>
                    <div className="flex flex-col items-center">
                      {images.squareSealImage ? (
                        <div className="relative mb-3">
                          <img
                            src={images.squareSealImage}
                            alt="角印"
                            className="w-32 h-32 object-contain border border-gray-300 rounded-lg bg-white"
                          />
                          {isAdmin() && (
                            <button
                              type="button"
                              onClick={() => handleImageDelete('squareSealImage')}
                              disabled={imageUploading.squareSealImage}
                              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 transition-colors disabled:opacity-50"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="w-32 h-32 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center mb-3 bg-white">
                          <Image size={32} className="text-gray-400" />
                        </div>
                      )}
                      {isAdmin() && (
                        <label className="cursor-pointer">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp"
                            className="hidden"
                            onChange={(e) => handleImageUpload('squareSealImage', e.target.files[0])}
                            disabled={imageUploading.squareSealImage}
                          />
                          <span className={`inline-flex items-center space-x-1 text-sm px-3 py-1.5 rounded-lg transition-colors ${
                            imageUploading.squareSealImage
                              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                              : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                          }`}>
                            {imageUploading.squareSealImage ? (
                              <>
                                <Loader2 size={14} className="animate-spin" />
                                <span>アップロード中...</span>
                              </>
                            ) : (
                              <>
                                <Upload size={14} />
                                <span>画像を選択</span>
                              </>
                            )}
                          </span>
                        </label>
                      )}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  ※ JPG、PNG、GIF、WEBP形式に対応。ファイルサイズは2MB以下。背景透過のPNG形式を推奨します。
                </p>
              </div>

              <hr />

              {/* 退職金制度 */}
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-4">退職金制度</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex items-center">
                    <label className={`flex items-center space-x-2 ${isAdmin() ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                      <input
                        type="checkbox"
                        checked={formData.retirementSystem}
                        onChange={(e) => handleChange('retirementSystem', e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
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
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                              />
                    </div>
                  )}
                </div>
              </div>

              <hr />

              {/* 日報削除設定 */}
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-4">日報削除機能</h2>
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <div className="flex items-start space-x-3">
                    <AlertCircle className="text-orange-500 flex-shrink-0 mt-0.5" size={20} />
                    <div className="flex-1">
                      <p className="text-sm text-orange-700 font-medium mb-2">
                        日報の削除を許可すると、日報管理画面から日報を完全に削除できるようになります。
                      </p>
                      <p className="text-sm text-orange-600 mb-4">
                        削除された日報はデータベースから完全に削除され、復元できません。
                      </p>
                      <label className={`flex items-center space-x-3 ${isAdmin() ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                        <input
                          type="checkbox"
                          checked={formData.allowReportDeletion}
                          onChange={(e) => handleChange('allowReportDeletion', e.target.checked)}
                          className="w-5 h-5 rounded border-orange-300 text-orange-600 focus:ring-orange-500 disabled:opacity-50"
                                                  />
                        <span className="text-sm font-medium text-gray-700">
                          日報の削除を許可する
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              <hr />

              {/* 解約 */}
              <div>
                <h2 className="text-lg font-semibold text-red-600 mb-4">解約</h2>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-start space-x-3">
                    <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
                    <div>
                      <p className="text-sm text-red-700 font-medium">
                        解約すると全ての機能が利用できなくなります。
                      </p>
                      <p className="text-sm text-red-600 mt-1">
                        社員情報・日報データ・設定など、全てのデータにアクセスできなくなります。この操作は取り消せません。
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowCancelModal(true)}
                        disabled={!isAdmin()}
                        className="mt-4 inline-flex items-center space-x-2 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <X size={16} />
                        <span>解約する</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 銀行情報タブ */}
          {activeTab === 'bank' && (
            <div>
              {/* 管理者権限チェック */}
              {!isAdmin() && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start space-x-3 mb-6">
                  <AlertCircle className="text-yellow-600 flex-shrink-0 mt-0.5" size={20} />
                  <div>
                    <p className="text-yellow-800 font-medium">閲覧のみ</p>
                    <p className="text-yellow-700 text-sm">銀行情報の変更は管理者のみ可能です。</p>
                  </div>
                </div>
              )}

              <h2 className="text-lg font-semibold text-gray-800 mb-4">銀行口座情報</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">銀行名</label>
                  <input
                    type="text"
                    value={formData.bankInfo.bankName}
                    onChange={(e) => handleChange('bankInfo.bankName', e.target.value)}
                    placeholder="サンプル銀行"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    disabled={!isAdmin()}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">支店名</label>
                  <input
                    type="text"
                    value={formData.bankInfo.branchName}
                    onChange={(e) => handleChange('bankInfo.branchName', e.target.value)}
                    placeholder="東京支店"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    disabled={!isAdmin()}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">口座種類</label>
                  <select
                    value={formData.bankInfo.accountType}
                    onChange={(e) => handleChange('bankInfo.accountType', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    disabled={!isAdmin()}
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
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    disabled={!isAdmin()}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">口座名義人</label>
                  <input
                    type="text"
                    value={formData.bankInfo.accountHolder}
                    onChange={(e) => handleChange('bankInfo.accountHolder', e.target.value)}
                    placeholder="カ）サンプル"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    disabled={!isAdmin()}
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

          {/* 決済情報タブ */}
          {activeTab === 'billing' && (
            <div className="space-y-8">
              {/* 管理者権限チェック */}
              {!isAdmin() && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start space-x-3">
                  <AlertCircle className="text-yellow-600 flex-shrink-0 mt-0.5" size={20} />
                  <div>
                    <p className="text-yellow-800 font-medium">閲覧のみ</p>
                    <p className="text-yellow-700 text-sm">決済情報の変更は管理者のみ可能です。</p>
                  </div>
                </div>
              )}

              {/* ご利用状況 */}
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-4">ご利用状況</h2>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center space-x-3 mb-3">
                    <span className="text-sm font-medium text-gray-600">ステータス:</span>
                    {billing?.status === 'trial' && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                        無料トライアル中
                      </span>
                    )}
                    {billing?.status === 'active' && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                        アクティブ
                      </span>
                    )}
                    {billing?.status === 'past_due' && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
                        支払い遅延
                      </span>
                    )}
                    {billing?.status === 'canceled' && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800">
                        キャンセル済み
                      </span>
                    )}
                    {!billing?.status && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-600">
                        未設定
                      </span>
                    )}
                  </div>
                  {billing?.trialEndsAt && (
                    <div className="flex items-center space-x-3">
                      <span className="text-sm font-medium text-gray-600">トライアル期間:</span>
                      <span className="text-sm text-gray-800">
                        {billing.trialEndsAt.toDate
                          ? `〜 ${billing.trialEndsAt.toDate().toLocaleDateString('ja-JP')}`
                          : ''}
                      </span>
                    </div>
                  )}
                  {billing?.paymentMethod === 'card' && billing?.cardLast4 && (
                    <div className="flex items-center space-x-3 mt-3">
                      <span className="text-sm font-medium text-gray-600">登録カード:</span>
                      <span className="text-sm text-gray-800">
                        {CARD_BRAND_LABELS[billing.cardBrand] || billing.cardBrand} **** {billing.cardLast4}
                      </span>
                    </div>
                  )}
                  {billing?.paymentMethod === 'invoice' && (
                    <div className="flex items-center space-x-3 mt-3">
                      <span className="text-sm font-medium text-gray-600">支払い方法:</span>
                      <span className="text-sm text-gray-800">請求書払い</span>
                    </div>
                  )}
                </div>
              </div>

              <hr />

              {/* お支払い方法 */}
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-4">お支払い方法</h2>

                {/* 支払い方法選択 */}
                <div className="space-y-3 mb-6">
                  <label className={`flex items-start space-x-3 p-4 border rounded-lg transition-colors ${
                    selectedPaymentMethod === 'card' ? 'border-blue-500 bg-blue-50' : ''
                  } ${isAdmin() ? 'cursor-pointer hover:bg-gray-50' : 'cursor-not-allowed opacity-60'}`}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="card"
                      checked={selectedPaymentMethod === 'card'}
                      onChange={() => setSelectedPaymentMethod('card')}
                      className="mt-1 text-blue-600"
                                          />
                    <div>
                      <span className="font-medium text-gray-900 flex items-center space-x-2">
                        <CreditCard size={18} />
                        <span>クレジットカード</span>
                      </span>
                      <p className="text-sm text-gray-500 mt-1">Visa, Mastercard, JCB, American Express に対応</p>
                    </div>
                  </label>

                  {/* 請求書払いは一時的に無効化
                  <label className={`flex items-start space-x-3 p-4 border rounded-lg transition-colors ${
                    selectedPaymentMethod === 'invoice' ? 'border-blue-500 bg-blue-50' : ''
                  } ${isAdmin() ? 'cursor-pointer hover:bg-gray-50' : 'cursor-not-allowed opacity-60'}`}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="invoice"
                      checked={selectedPaymentMethod === 'invoice'}
                      onChange={() => setSelectedPaymentMethod('invoice')}
                      className="mt-1 text-blue-600"
                                          />
                    <div>
                      <span className="font-medium text-gray-900 flex items-center space-x-2">
                        <FileText size={18} />
                        <span>請求書払い</span>
                      </span>
                      <p className="text-sm text-gray-500 mt-1">月末締め翌月末払いの請求書をお送りします</p>
                    </div>
                  </label>
                  */}
                </div>

                {/* クレジットカード登録フォーム */}
                {selectedPaymentMethod === 'card' && isAdmin() && (
                  <div className="bg-gray-50 rounded-lg p-6">
                    <h3 className="text-sm font-medium text-gray-700 mb-4">カード情報の入力</h3>
                    {PAYJP_PUBLIC_KEY && window.Payjp ? (
                      <PayjpCardForm
                        companyId={companyId}
                        onSuccess={handleCardSuccess}
                        onError={(err) => setError(err.message || 'カード登録に失敗しました')}
                      />
                    ) : (
                      <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-lg text-sm">
                        <strong>設定が必要です:</strong> PAY.JP公開キー（VITE_PAYJP_PUBLIC_KEY）が設定されていません。
                        環境変数を設定してください。
                      </div>
                    )}
                    <p className="text-xs text-gray-500 mt-4">
                      ※ カード情報はPAY.JP社により安全に管理されます。当社サーバーにカード番号は保存されません。
                    </p>
                  </div>
                )}

                {/* 請求書払い申請フォーム - 一時的に無効化
                {selectedPaymentMethod === 'invoice' && isAdmin() && (
                  <div className="bg-gray-50 rounded-lg p-6">
                    <h3 className="text-sm font-medium text-gray-700 mb-4">請求書払い申請</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          担当者名 <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={invoiceForm.contactName}
                          onChange={(e) => setInvoiceForm(prev => ({ ...prev, contactName: e.target.value }))}
                          placeholder="経理太郎"
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          請求先住所
                        </label>
                        <input
                          type="text"
                          value={invoiceForm.billingAddress}
                          onChange={(e) => setInvoiceForm(prev => ({ ...prev, billingAddress: e.target.value }))}
                          placeholder="東京都渋谷区..."
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          備考
                        </label>
                        <textarea
                          value={invoiceForm.note}
                          onChange={(e) => setInvoiceForm(prev => ({ ...prev, note: e.target.value }))}
                          rows={3}
                          placeholder="ご要望がありましたらご記入ください"
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleInvoiceSubmit}
                        disabled={invoiceSubmitting}
                        className="inline-flex items-center space-x-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {invoiceSubmitting ? (
                          <>
                            <Loader2 size={18} className="animate-spin" />
                            <span>送信中...</span>
                          </>
                        ) : (
                          <>
                            <FileText size={18} />
                            <span>請求書払いを申請</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
                */}
              </div>

              <hr />

              {/* 料金プラン */}
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-4">料金プラン</h2>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
                  <div className="text-4xl mb-3">📋</div>
                  <p className="text-gray-600 font-medium">料金プランは準備中です</p>
                  <p className="text-sm text-gray-500 mt-2">
                    詳細が決まり次第、こちらに表示されます。
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 雇用形態タブ */}
          {activeTab === 'employmentType' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-2">雇用形態の設定</h2>
                <p className="text-sm text-gray-600 mb-4">
                  社員登録時に選択できる雇用形態を設定します。名称や表示色をカスタマイズできます。
                </p>
              </div>

              {/* 雇用形態リスト */}
              <div className="space-y-3">
                {formData.employmentTypes.map((type, index) => (
                  <div
                    key={type.id}
                    className="flex items-center space-x-3 p-4 bg-gray-50 rounded-lg"
                  >
                    {/* 並び替えボタン */}
                    <div className="flex flex-col space-y-1">
                      <button
                        type="button"
                        onClick={() => moveEmploymentTypeUp(index)}
                        disabled={index === 0}
                        className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveEmploymentTypeDown(index)}
                        disabled={index === formData.employmentTypes.length - 1}
                        className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronDown size={16} />
                      </button>
                    </div>

                    {/* 色プレビュー */}
                    <div className={`px-3 py-1 rounded-full text-xs font-medium ${EMPLOYMENT_TYPE_COLORS[type.color]?.bg || 'bg-gray-100'} ${EMPLOYMENT_TYPE_COLORS[type.color]?.text || 'text-gray-800'}`}>
                      {type.label}
                    </div>

                    {/* ラベル入力 */}
                    <input
                      type="text"
                      value={type.label}
                      onChange={(e) => updateEmploymentType(index, 'label', e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                      placeholder="雇用形態名"
                    />

                    {/* 色選択 */}
                    <select
                      value={type.color}
                      onChange={(e) => updateEmploymentType(index, 'color', e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    >
                      {Object.entries(EMPLOYMENT_TYPE_COLORS).map(([colorKey, colorValue]) => (
                        <option key={colorKey} value={colorKey}>
                          {colorValue.label}
                        </option>
                      ))}
                    </select>

                    {/* 削除ボタン */}
                    <button
                      type="button"
                      onClick={() => removeEmploymentType(index)}
                      disabled={type.isDefault}
                      className={`p-2 rounded-lg transition-colors ${
                        type.isDefault
                          ? 'text-gray-300 cursor-not-allowed'
                          : 'text-red-600 hover:bg-red-50'
                      }`}
                      title={type.isDefault ? 'デフォルト項目は削除できません' : '削除'}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>

              {/* 追加ボタン */}
              <button
                type="button"
                onClick={addEmploymentType}
                className="flex items-center space-x-2 text-blue-600 hover:text-blue-800 text-sm"
              >
                <Plus size={16} />
                <span>雇用形態を追加</span>
              </button>

              <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-sm">
                <strong>ヒント:</strong> デフォルトの5種類（正社員・契約社員・パート・アルバイト・外部）は削除できません。名称や色の変更は可能です。
              </div>
            </div>
          )}
        </form>
      </div>

      {/* 解約確認モーダル */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-red-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                <AlertCircle className="text-red-600" size={32} />
              </div>
              <h2 className="text-xl font-bold text-gray-800">本当に解約しますか？</h2>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-red-700 font-medium mb-2">解約すると以下の影響があります:</p>
              <ul className="text-sm text-red-600 space-y-1 list-disc list-inside">
                <li>全ての管理機能が利用できなくなります</li>
                <li>社員・取引先・現場のデータにアクセスできなくなります</li>
                <li>日報の閲覧・承認ができなくなります</li>
                <li>この操作は取り消せません</li>
              </ul>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                確認のため、会社名「<span className="font-bold text-red-600">{formData.companyName}</span>」を入力してください
              </label>
              <input
                type="text"
                value={cancelConfirmName}
                onChange={(e) => setCancelConfirmName(e.target.value)}
                placeholder={formData.companyName}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
              />
            </div>

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => {
                  setShowCancelModal(false);
                  setCancelConfirmName('');
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleCancelCompany}
                disabled={cancelConfirmName !== formData.companyName || canceling}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {canceling ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>処理中...</span>
                  </>
                ) : (
                  <span>解約を確定する</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
