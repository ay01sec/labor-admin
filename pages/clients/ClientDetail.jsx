// src/pages/clients/ClientDetail.jsx
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
  Building2,
  AlertCircle
} from 'lucide-react';

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { companyId, isAdmin } = useAuth();
  const isNew = id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    clientName: '',
    postalCode: '',
    prefecture: '',
    city: '',
    address: '',
    building: '',
    tel: '',
    fax: '',
    email: '',
    managerName: ''
  });

  // データ取得
  useEffect(() => {
    if (isNew || !companyId) {
      setLoading(false);
      return;
    }

    const fetchClient = async () => {
      try {
        const docRef = doc(db, 'companies', companyId, 'clients', id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          setFormData(docSnap.data());
        } else {
          setError('取引先が見つかりません');
        }
      } catch (error) {
        console.error('データ取得エラー:', error);
        setError('データの取得に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    fetchClient();
  }, [id, companyId, isNew]);

  // フォーム変更ハンドラ
  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // 保存処理
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.clientName.trim()) {
      setError('取引先名は必須です');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const dataToSave = {
        ...formData,
        updatedAt: serverTimestamp()
      };

      if (isNew) {
        dataToSave.createdAt = serverTimestamp();
        const newDocRef = doc(db, 'companies', companyId, 'clients', crypto.randomUUID());
        await setDoc(newDocRef, dataToSave);
      } else {
        const docRef = doc(db, 'companies', companyId, 'clients', id);
        await updateDoc(docRef, dataToSave);
      }

      navigate('/clients');
    } catch (error) {
      console.error('保存エラー:', error);
      setError('保存に失敗しました');
    } finally {
      setSaving(false);
    }
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
        <div className="flex items-center space-x-4">
          <Link
            to="/clients"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center space-x-2">
            <Building2 className="text-green-500" />
            <span>{isNew ? '取引先登録' : formData.clientName}</span>
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

      {/* フォーム */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 基本情報 */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">基本情報</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  取引先名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.clientName}
                  onChange={(e) => handleChange('clientName', e.target.value)}
                  placeholder="株式会社サンプル"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">担当者名</label>
                <input
                  type="text"
                  value={formData.managerName}
                  onChange={(e) => handleChange('managerName', e.target.value)}
                  placeholder="山田 太郎"
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
        </form>
      </div>
    </div>
  );
}
