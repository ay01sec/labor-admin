// src/pages/employees/EmployeeDetail.jsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import {
  Save,
  ArrowLeft,
  User,
  MapPin,
  Briefcase,
  Wallet,
  Shield,
  Award,
  Users,
  Heart,
  AlertCircle
} from 'lucide-react';

// タブ定義
const tabs = [
  { id: 'basic', label: '基本情報', icon: User },
  { id: 'address', label: '住所・連絡先', icon: MapPin, adminOnly: true },
  { id: 'employment', label: '雇用情報', icon: Briefcase },
  { id: 'salary', label: '給与', icon: Wallet, adminOnly: true },
  { id: 'insurance', label: '保険', icon: Shield, adminOnly: true },
  { id: 'qualifications', label: '資格・免許', icon: Award },
  { id: 'family', label: '家族', icon: Users, adminOnly: true },
];

export default function EmployeeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { companyId, isAdmin } = useAuth();
  const isNew = id === 'new';

  const [activeTab, setActiveTab] = useState('basic');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // フォームデータ
  const [formData, setFormData] = useState({
    lastName: '',
    lastNameKana: '',
    firstName: '',
    firstNameKana: '',
    birthDate: '',
    gender: '',
    bloodType: '',
    address: {
      postalCode: '',
      prefecture: '',
      city: '',
      address: '',
      building: ''
    },
    contact: {
      mobile: '',
      other: '',
      email: ''
    },
    employment: {
      type: '',
      hireDate: '',
      resignationDate: '',
      experienceStartYear: '',
      role: '',
      isForeman: false
    },
    salary: {
      baseSalary: '',
      housingAllowance: '',
      foremanAllowance: '',
      commuteAllowance: '',
      otherAllowance: ''
    },
    retirement: {
      hasSystem: false,
      number: ''
    },
    insurance: {
      socialInsuranceNumber: '',
      pensionNumber: '',
      employmentInsuranceNumber: ''
    },
    health: {
      lastCheckup: '',
      bloodPressureHigh: '',
      bloodPressureLow: ''
    },
    bankInfo: {
      bankName: '',
      branchName: '',
      accountType: '',
      accountNumber: '',
      accountHolder: ''
    },
    qualifications: [''],
    licenses: [''],
    family: [],
    isActive: true
  });

  // データ取得
  useEffect(() => {
    if (isNew || !companyId) {
      setLoading(false);
      return;
    }

    const fetchEmployee = async () => {
      try {
        const docRef = doc(db, 'companies', companyId, 'employees', id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          
          // タイムスタンプを文字列に変換
          const formatDate = (timestamp) => {
            if (!timestamp) return '';
            const date = timestamp.toDate?.() || new Date(timestamp);
            return date.toISOString().split('T')[0];
          };

          setFormData({
            ...data,
            birthDate: formatDate(data.birthDate),
            employment: {
              ...data.employment,
              hireDate: formatDate(data.employment?.hireDate),
              resignationDate: formatDate(data.employment?.resignationDate)
            },
            health: {
              ...data.health,
              lastCheckup: formatDate(data.health?.lastCheckup)
            },
            qualifications: data.qualifications?.length > 0 ? data.qualifications : [''],
            licenses: data.licenses?.length > 0 ? data.licenses : ['']
          });
        } else {
          setError('社員が見つかりません');
        }
      } catch (error) {
        console.error('データ取得エラー:', error);
        setError('データの取得に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    fetchEmployee();
  }, [id, companyId, isNew]);

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

  // 配列フィールドの変更
  const handleArrayChange = (field, index, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].map((item, i) => i === index ? value : item)
    }));
  };

  // 配列フィールドの追加
  const handleArrayAdd = (field) => {
    setFormData(prev => ({
      ...prev,
      [field]: [...prev[field], '']
    }));
  };

  // 配列フィールドの削除
  const handleArrayRemove = (field, index) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== index)
    }));
  };

  // 保存処理
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      // 日付を変換
      const parseDate = (dateStr) => {
        if (!dateStr) return null;
        return new Date(dateStr);
      };

      const dataToSave = {
        ...formData,
        birthDate: parseDate(formData.birthDate),
        employment: {
          ...formData.employment,
          hireDate: parseDate(formData.employment.hireDate),
          resignationDate: parseDate(formData.employment.resignationDate),
          experienceStartYear: formData.employment.experienceStartYear
            ? parseInt(formData.employment.experienceStartYear)
            : null
        },
        salary: {
          baseSalary: parseInt(formData.salary.baseSalary) || 0,
          housingAllowance: parseInt(formData.salary.housingAllowance) || 0,
          foremanAllowance: parseInt(formData.salary.foremanAllowance) || 0,
          commuteAllowance: parseInt(formData.salary.commuteAllowance) || 0,
          otherAllowance: parseInt(formData.salary.otherAllowance) || 0
        },
        health: {
          ...formData.health,
          lastCheckup: parseDate(formData.health.lastCheckup),
          bloodPressureHigh: parseInt(formData.health.bloodPressureHigh) || null,
          bloodPressureLow: parseInt(formData.health.bloodPressureLow) || null
        },
        qualifications: formData.qualifications.filter(q => q.trim() !== ''),
        licenses: formData.licenses.filter(l => l.trim() !== ''),
        updatedAt: serverTimestamp()
      };

      if (isNew) {
        dataToSave.createdAt = serverTimestamp();
        const newDocRef = doc(db, 'companies', companyId, 'employees', crypto.randomUUID());
        await setDoc(newDocRef, dataToSave);
      } else {
        const docRef = doc(db, 'companies', companyId, 'employees', id);
        await updateDoc(docRef, dataToSave);
      }

      navigate('/employees');
    } catch (error) {
      console.error('保存エラー:', error);
      setError('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // 表示するタブをフィルタ
  const visibleTabs = tabs.filter(tab => !tab.adminOnly || isAdmin());

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
        <div className="flex items-center space-x-4">
          <Link
            to="/employees"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-bold text-gray-800">
            {isNew ? '社員登録' : `${formData.lastName} ${formData.firstName}`}
          </h1>
        </div>
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

      {/* タブ */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="border-b border-gray-200">
          <nav className="flex overflow-x-auto">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
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
          {/* 基本情報タブ */}
          {activeTab === 'basic' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  氏 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => handleChange('lastName', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => handleChange('firstName', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">氏（ひらがな）</label>
                <input
                  type="text"
                  value={formData.lastNameKana}
                  onChange={(e) => handleChange('lastNameKana', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名（ひらがな）</label>
                <input
                  type="text"
                  value={formData.firstNameKana}
                  onChange={(e) => handleChange('firstNameKana', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              {isAdmin() && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">生年月日</label>
                  <input
                    type="date"
                    value={formData.birthDate}
                    onChange={(e) => handleChange('birthDate', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">性別</label>
                <select
                  value={formData.gender}
                  onChange={(e) => handleChange('gender', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">選択してください</option>
                  <option value="男性">男性</option>
                  <option value="女性">女性</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">血液型</label>
                <select
                  value={formData.bloodType}
                  onChange={(e) => handleChange('bloodType', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">選択してください</option>
                  <option value="A">A型</option>
                  <option value="B">B型</option>
                  <option value="O">O型</option>
                  <option value="AB">AB型</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">在籍状況</label>
                <select
                  value={formData.isActive ? 'active' : 'inactive'}
                  onChange={(e) => handleChange('isActive', e.target.value === 'active')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="active">在籍</option>
                  <option value="inactive">退職</option>
                </select>
              </div>
            </div>
          )}

          {/* 住所・連絡先タブ */}
          {activeTab === 'address' && isAdmin() && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">郵便番号</label>
                  <input
                    type="text"
                    value={formData.address?.postalCode || ''}
                    onChange={(e) => handleChange('address.postalCode', e.target.value)}
                    placeholder="000-0000"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">都道府県</label>
                  <input
                    type="text"
                    value={formData.address?.prefecture || ''}
                    onChange={(e) => handleChange('address.prefecture', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">市区町村</label>
                  <input
                    type="text"
                    value={formData.address?.city || ''}
                    onChange={(e) => handleChange('address.city', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">番地号</label>
                  <input
                    type="text"
                    value={formData.address?.address || ''}
                    onChange={(e) => handleChange('address.address', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">建物名</label>
                  <input
                    type="text"
                    value={formData.address?.building || ''}
                    onChange={(e) => handleChange('address.building', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <hr className="my-6" />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">携帯番号</label>
                  <input
                    type="tel"
                    value={formData.contact?.mobile || ''}
                    onChange={(e) => handleChange('contact.mobile', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">その他連絡先</label>
                  <input
                    type="tel"
                    value={formData.contact?.other || ''}
                    onChange={(e) => handleChange('contact.other', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス</label>
                  <input
                    type="email"
                    value={formData.contact?.email || ''}
                    onChange={(e) => handleChange('contact.email', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 雇用情報タブ */}
          {activeTab === 'employment' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">雇用形態</label>
                <select
                  value={formData.employment?.type || ''}
                  onChange={(e) => handleChange('employment.type', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">選択してください</option>
                  <option value="正社員">正社員</option>
                  <option value="契約社員">契約社員</option>
                  <option value="パート">パート</option>
                  <option value="アルバイト">アルバイト</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">入社日</label>
                <input
                  type="date"
                  value={formData.employment?.hireDate || ''}
                  onChange={(e) => handleChange('employment.hireDate', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">退職日</label>
                <input
                  type="date"
                  value={formData.employment?.resignationDate || ''}
                  onChange={(e) => handleChange('employment.resignationDate', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">経験年数開始年</label>
                <input
                  type="number"
                  value={formData.employment?.experienceStartYear || ''}
                  onChange={(e) => handleChange('employment.experienceStartYear', e.target.value)}
                  placeholder="例: 2015"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">任務</label>
                <input
                  type="text"
                  value={formData.employment?.role || ''}
                  onChange={(e) => handleChange('employment.role', e.target.value)}
                  placeholder="例: 現場作業員"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="flex items-center">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.employment?.isForeman || false}
                    onChange={(e) => handleChange('employment.isForeman', e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">職長</span>
                </label>
              </div>
            </div>
          )}

          {/* 給与タブ */}
          {activeTab === 'salary' && isAdmin() && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">基本給</label>
                <div className="relative">
                  <input
                    type="number"
                    value={formData.salary?.baseSalary || ''}
                    onChange={(e) => handleChange('salary.baseSalary', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-8"
                  />
                  <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500">円</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">住宅手当</label>
                <div className="relative">
                  <input
                    type="number"
                    value={formData.salary?.housingAllowance || ''}
                    onChange={(e) => handleChange('salary.housingAllowance', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-8"
                  />
                  <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500">円</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">職長手当</label>
                <div className="relative">
                  <input
                    type="number"
                    value={formData.salary?.foremanAllowance || ''}
                    onChange={(e) => handleChange('salary.foremanAllowance', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-8"
                  />
                  <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500">円</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">通勤手当</label>
                <div className="relative">
                  <input
                    type="number"
                    value={formData.salary?.commuteAllowance || ''}
                    onChange={(e) => handleChange('salary.commuteAllowance', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-8"
                  />
                  <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500">円</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">その他手当</label>
                <div className="relative">
                  <input
                    type="number"
                    value={formData.salary?.otherAllowance || ''}
                    onChange={(e) => handleChange('salary.otherAllowance', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-8"
                  />
                  <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500">円</span>
                </div>
              </div>
            </div>
          )}

          {/* 資格・免許タブ */}
          {activeTab === 'qualifications' && (
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">資格</label>
                  <button
                    type="button"
                    onClick={() => handleArrayAdd('qualifications')}
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    + 追加
                  </button>
                </div>
                <div className="space-y-2">
                  {formData.qualifications.map((qual, index) => (
                    <div key={index} className="flex items-center space-x-2">
                      <input
                        type="text"
                        value={qual}
                        onChange={(e) => handleArrayChange('qualifications', index, e.target.value)}
                        placeholder="資格名を入力"
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                      {formData.qualifications.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleArrayRemove('qualifications', index)}
                          className="text-red-600 hover:text-red-800 p-2"
                        >
                          削除
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <hr />

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">免許</label>
                  <button
                    type="button"
                    onClick={() => handleArrayAdd('licenses')}
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    + 追加
                  </button>
                </div>
                <div className="space-y-2">
                  {formData.licenses.map((license, index) => (
                    <div key={index} className="flex items-center space-x-2">
                      <input
                        type="text"
                        value={license}
                        onChange={(e) => handleArrayChange('licenses', index, e.target.value)}
                        placeholder="免許名を入力"
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                      {formData.licenses.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleArrayRemove('licenses', index)}
                          className="text-red-600 hover:text-red-800 p-2"
                        >
                          削除
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 保険タブ（省略 - 同様のパターン） */}
          {activeTab === 'insurance' && isAdmin() && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">社会保険番号</label>
                <input
                  type="text"
                  value={formData.insurance?.socialInsuranceNumber || ''}
                  onChange={(e) => handleChange('insurance.socialInsuranceNumber', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">年金番号</label>
                <input
                  type="text"
                  value={formData.insurance?.pensionNumber || ''}
                  onChange={(e) => handleChange('insurance.pensionNumber', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">雇用保険番号</label>
                <input
                  type="text"
                  value={formData.insurance?.employmentInsuranceNumber || ''}
                  onChange={(e) => handleChange('insurance.employmentInsuranceNumber', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          )}

          {/* 家族タブ（省略 - 同様のパターン） */}
          {activeTab === 'family' && isAdmin() && (
            <div className="text-center text-gray-500 py-8">
              <Users size={48} className="mx-auto mb-4 text-gray-300" />
              <p>家族情報の編集機能は開発中です</p>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
