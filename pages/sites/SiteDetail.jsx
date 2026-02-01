// src/pages/sites/SiteDetail.jsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import {
  Save,
  ArrowLeft,
  MapPin,
  AlertCircle
} from 'lucide-react';

export default function SiteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { companyId, isAdmin } = useAuth();
  const isNew = id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [clients, setClients] = useState([]);

  const [formData, setFormData] = useState({
    siteName: '',
    clientId: '',
    clientName: '',
    address: '',
    startDate: '',
    endDate: '',
    status: 'pending'
  });

  // データ取得
  useEffect(() => {
    if (!companyId) return;

    const fetchData = async () => {
      try {
        // 取引先データ取得
        const clientsRef = collection(db, 'companies', companyId, 'clients');
        const clientsSnapshot = await getDocs(clientsRef);
        const clientsData = clientsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setClients(clientsData);

        // 現場データ取得（編集時）
        if (!isNew) {
          const docRef = doc(db, 'companies', companyId, 'sites', id);
          const docSnap = await getDoc(docRef);

          if (docSnap.exists()) {
            const data = docSnap.data();
            
            // 日付を文字列に変換
            const formatDate = (timestamp) => {
              if (!timestamp) return '';
              const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
              return date.toISOString().split('T')[0];
            };

            setFormData({
              ...data,
              startDate: formatDate(data.startDate),
              endDate: formatDate(data.endDate)
            });
          } else {
            setError('現場が見つかりません');
          }
        }
      } catch (error) {
        console.error('データ取得エラー:', error);
        setError('データの取得に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id, companyId, isNew]);

  // フォーム変更ハンドラ
  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    // 取引先選択時に取引先名も更新
    if (field === 'clientId') {
      const selectedClient = clients.find(c => c.id === value);
      setFormData(prev => ({
        ...prev,
        clientId: value,
        clientName: selectedClient?.clientName || ''
      }));
    }
  };

  // 保存処理
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.siteName.trim()) {
      setError('現場名は必須です');
      return;
    }

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
        startDate: parseDate(formData.startDate),
        endDate: parseDate(formData.endDate),
        updatedAt: serverTimestamp()
      };

      if (isNew) {
        dataToSave.createdAt = serverTimestamp();
        const newDocRef = doc(db, 'companies', companyId, 'sites', crypto.randomUUID());
        await setDoc(newDocRef, dataToSave);
      } else {
        const docRef = doc(db, 'companies', companyId, 'sites', id);
        await updateDoc(docRef, dataToSave);
      }

      navigate('/sites');
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
            to="/sites"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center space-x-2">
            <MapPin className="text-purple-500" />
            <span>{isNew ? '現場登録' : formData.siteName}</span>
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
                  現場名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.siteName}
                  onChange={(e) => handleChange('siteName', e.target.value)}
                  placeholder="現場A"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">取引先</label>
                <select
                  value={formData.clientId}
                  onChange={(e) => handleChange('clientId', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">選択してください</option>
                  {clients.map(client => (
                    <option key={client.id} value={client.id}>
                      {client.clientName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ステータス</label>
                <select
                  value={formData.status}
                  onChange={(e) => handleChange('status', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="pending">予定</option>
                  <option value="active">進行中</option>
                  <option value="completed">完了</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">住所</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => handleChange('address', e.target.value)}
                  placeholder="東京都新宿区1-2-3"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          <hr />

          {/* 工期 */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">工期</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">開始日</label>
                <input
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => handleChange('startDate', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">終了日</label>
                <input
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => handleChange('endDate', e.target.value)}
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
