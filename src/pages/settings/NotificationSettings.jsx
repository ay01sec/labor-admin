// src/pages/settings/NotificationSettings.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  collection,
  query,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import {
  ArrowLeft,
  Bell,
  Plus,
  Edit,
  Trash2,
  X,
  Save,
  AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';

// 繰り返し設定のラベル
const repeatLabels = {
  daily: '毎日',
  weekdays: '平日のみ',
  custom: '曜日指定',
};

// 曜日のラベル
const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];

export default function NotificationSettings() {
  const navigate = useNavigate();
  const { companyId, isAdmin } = useAuth();

  const [notifications, setNotifications] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [formData, setFormData] = useState({
    siteId: '',
    time: '12:00',
    message: '',
    repeat: 'daily',
    customDays: [],
    targetRoles: ['user', 'manager'],
    enabled: true,
  });

  // データ取得
  useEffect(() => {
    if (!companyId) return;

    const fetchData = async () => {
      try {
        // 現場一覧取得
        const sitesRef = collection(db, 'companies', companyId, 'sites');
        const sitesSnapshot = await getDocs(sitesRef);
        const sitesData = sitesSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setSites(sitesData);

        // カスタム通知取得
        const notificationsRef = collection(db, 'customNotifications');
        const q = query(notificationsRef, where('companyId', '==', companyId));
        const notificationsSnapshot = await getDocs(q);
        const notificationsData = notificationsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setNotifications(notificationsData);
      } catch (error) {
        console.error('データ取得エラー:', error);
        toast.error('データの取得に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [companyId]);

  // フォームリセット
  const resetForm = () => {
    setFormData({
      siteId: '',
      time: '12:00',
      message: '',
      repeat: 'daily',
      customDays: [],
      targetRoles: ['user', 'manager'],
      enabled: true,
    });
    setEditingId(null);
  };

  // モーダルを開く（新規）
  const openNewModal = () => {
    resetForm();
    setShowModal(true);
  };

  // モーダルを開く（編集）
  const openEditModal = (notification) => {
    setFormData({
      siteId: notification.siteId || '',
      time: notification.time || '12:00',
      message: notification.message || '',
      repeat: notification.repeat || 'daily',
      customDays: notification.customDays || [],
      targetRoles: notification.targetRoles || ['user', 'manager'],
      enabled: notification.enabled !== false,
    });
    setEditingId(notification.id);
    setShowModal(true);
  };

  // 保存処理
  const handleSave = async () => {
    if (!formData.message.trim()) {
      toast.error('メッセージを入力してください');
      return;
    }

    if (formData.repeat === 'custom' && formData.customDays.length === 0) {
      toast.error('曜日を選択してください');
      return;
    }

    try {
      const site = sites.find((s) => s.id === formData.siteId);

      const data = {
        companyId,
        siteId: formData.siteId || null,
        siteName: site?.siteName || null,
        time: formData.time,
        message: formData.message,
        repeat: formData.repeat,
        customDays: formData.repeat === 'custom' ? formData.customDays : null,
        targetRoles: formData.targetRoles,
        enabled: formData.enabled,
        updatedAt: serverTimestamp(),
      };

      if (editingId) {
        // 更新
        await updateDoc(doc(db, 'customNotifications', editingId), data);
        setNotifications((prev) =>
          prev.map((n) => (n.id === editingId ? { ...n, ...data } : n))
        );
        toast.success('更新しました');
      } else {
        // 新規作成
        data.createdAt = serverTimestamp();
        const docRef = await addDoc(collection(db, 'customNotifications'), data);
        setNotifications((prev) => [...prev, { id: docRef.id, ...data }]);
        toast.success('作成しました');
      }

      setShowModal(false);
      resetForm();
    } catch (error) {
      console.error('保存エラー:', error);
      toast.error('保存に失敗しました');
    }
  };

  // 削除処理
  const handleDelete = async (id) => {
    if (!confirm('この通知設定を削除しますか？')) return;

    try {
      await deleteDoc(doc(db, 'customNotifications', id));
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      toast.success('削除しました');
    } catch (error) {
      console.error('削除エラー:', error);
      toast.error('削除に失敗しました');
    }
  };

  // 有効/無効の切り替え
  const toggleEnabled = async (notification) => {
    try {
      const newEnabled = !notification.enabled;
      await updateDoc(doc(db, 'customNotifications', notification.id), {
        enabled: newEnabled,
        updatedAt: serverTimestamp(),
      });
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notification.id ? { ...n, enabled: newEnabled } : n
        )
      );
      toast.success(newEnabled ? '有効にしました' : '無効にしました');
    } catch (error) {
      console.error('切り替えエラー:', error);
      toast.error('切り替えに失敗しました');
    }
  };

  // 曜日の選択/解除
  const toggleDay = (day) => {
    setFormData((prev) => ({
      ...prev,
      customDays: prev.customDays.includes(day)
        ? prev.customDays.filter((d) => d !== day)
        : [...prev.customDays, day].sort(),
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
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/settings')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center space-x-2">
            <Bell className="text-blue-500" />
            <span>カスタム通知設定</span>
          </h1>
        </div>
        {isAdmin() && (
          <button
            onClick={openNewModal}
            className="inline-flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={20} />
            <span>新規追加</span>
          </button>
        )}
      </div>

      {/* 説明 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <AlertCircle className="text-blue-600 mt-0.5" size={20} />
          <div className="text-sm text-blue-800">
            <p className="font-medium">カスタム通知について</p>
            <p className="mt-1">
              任意のメッセージを指定した時刻にプッシュ通知として送信できます。
              「全社共通」または「現場ごと」に設定可能です。
            </p>
          </div>
        </div>
      </div>

      {/* 通知一覧 */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {notifications.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    対象
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    時刻
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    メッセージ
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    繰り返し
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    状態
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {notifications.map((notification) => (
                  <tr key={notification.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {notification.siteName || (
                        <span className="text-blue-600 font-medium">全社共通</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      {notification.time}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate">
                      {notification.message}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {repeatLabels[notification.repeat] || notification.repeat}
                      {notification.repeat === 'custom' &&
                        notification.customDays && (
                          <span className="text-xs text-gray-400 ml-1">
                            ({notification.customDays.map((d) => dayLabels[d]).join('')})
                          </span>
                        )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={() => toggleEnabled(notification)}
                        className={`px-3 py-1 rounded-full text-xs font-medium ${
                          notification.enabled
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {notification.enabled ? 'ON' : 'OFF'}
                      </button>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex items-center space-x-3">
                        <button
                          onClick={() => openEditModal(notification)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          <Edit size={18} />
                        </button>
                        <button
                          onClick={() => handleDelete(notification.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            <Bell size={48} className="mx-auto mb-4 text-gray-300" />
            <p>カスタム通知が設定されていません</p>
            {isAdmin() && (
              <button
                onClick={openNewModal}
                className="inline-flex items-center space-x-2 text-blue-600 hover:text-blue-800 mt-4"
              >
                <Plus size={18} />
                <span>最初の通知を追加する</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* モーダル */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-bold">
                {editingId ? '通知を編集' : '新規通知を追加'}
              </h3>
              <button
                onClick={() => {
                  setShowModal(false);
                  resetForm();
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* 対象 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  対象
                </label>
                <select
                  value={formData.siteId}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, siteId: e.target.value }))
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">全社共通</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.siteName}
                    </option>
                  ))}
                </select>
              </div>

              {/* 通知時刻 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  通知時刻
                </label>
                <input
                  type="time"
                  value={formData.time}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, time: e.target.value }))
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* メッセージ */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  メッセージ <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={formData.message}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, message: e.target.value }))
                  }
                  placeholder="通知に表示するメッセージ"
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* 繰り返し */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  繰り返し
                </label>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(repeatLabels).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({ ...prev, repeat: value }))
                      }
                      className={`px-4 py-2 rounded-lg text-sm ${
                        formData.repeat === value
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 曜日選択（custom時のみ） */}
              {formData.repeat === 'custom' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    曜日
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {dayLabels.map((label, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => toggleDay(index)}
                        className={`w-10 h-10 rounded-full text-sm ${
                          formData.customDays.includes(index)
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 有効/無効 */}
              <div className="flex items-center space-x-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.enabled}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, enabled: e.target.checked }))
                    }
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  <span className="ml-3 text-sm font-medium text-gray-700">
                    {formData.enabled ? '有効' : '無効'}
                  </span>
                </label>
              </div>
            </div>

            <div className="flex justify-end space-x-3 p-4 border-t">
              <button
                onClick={() => {
                  setShowModal(false);
                  resetForm();
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
              >
                <Save size={18} />
                <span>保存</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
