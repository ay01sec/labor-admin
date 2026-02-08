// src/pages/users/UserList.jsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  collection,
  query,
  getDocs,
  orderBy,
  doc,
  updateDoc
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../services/firebase';
import {
  Plus,
  Search,
  Edit,
  Lock,
  UserCheck,
  UserX,
  Shield,
  User,
  Mail,
  Trash2,
  Users
} from 'lucide-react';
import toast from 'react-hot-toast';

// 権限バッジ
function RoleBadge({ role }) {
  const badges = {
    admin: {
      bg: 'bg-red-100',
      text: 'text-red-800',
      icon: Shield,
      label: '管理者'
    },
    office: {
      bg: 'bg-orange-100',
      text: 'text-orange-800',
      icon: Users,
      label: '事務員'
    },
    manager: {
      // 後方互換性のため残す（office と同等）
      bg: 'bg-orange-100',
      text: 'text-orange-800',
      icon: Users,
      label: '事務員'
    },
    site_manager: {
      bg: 'bg-blue-100',
      text: 'text-blue-800',
      icon: User,
      label: '現場管理者'
    },
    worker: {
      bg: 'bg-gray-100',
      text: 'text-gray-800',
      icon: User,
      label: '作業員'
    }
  };

  const badge = badges[role] || badges.worker;
  const Icon = badge.icon;

  return (
    <span className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
      <Icon size={12} />
      <span>{badge.label}</span>
    </span>
  );
}

// ステータスバッジ
function StatusBadge({ isActive }) {
  if (isActive) {
    return (
      <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
        <UserCheck size={12} />
        <span>有効</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
      <UserX size={12} />
      <span>無効</span>
    </span>
  );
}

export default function UserList() {
  const { companyId, userInfo, isOfficeOrAbove, resetPassword } = useAuth();

  const [users, setUsers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // 削除モーダル用
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // データ取得
  useEffect(() => {
    if (!companyId) return;

    const fetchData = async () => {
      try {
        // ユーザーデータ取得
        const usersRef = collection(db, 'companies', companyId, 'users');
        const usersQuery = query(usersRef, orderBy('createdAt', 'desc'));
        const usersSnapshot = await getDocs(usersQuery);

        const usersData = usersSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setUsers(usersData);

        // 社員データ取得（紐付け表示用）
        const employeesRef = collection(db, 'companies', companyId, 'employees');
        const employeesSnapshot = await getDocs(employeesRef);
        const employeesData = employeesSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setEmployees(employeesData);

      } catch (error) {
        console.error('データ取得エラー:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [companyId]);

  // フィルタリング
  const filteredUsers = users.filter(user => {
    const matchesSearch =
      (user.displayName || '').includes(searchTerm) ||
      (user.email || '').includes(searchTerm);
    return matchesSearch;
  });

  // 社員名を取得
  const getEmployeeName = (employeeId) => {
    const employee = employees.find(e => e.id === employeeId);
    if (employee) {
      return `${employee.lastName} ${employee.firstName}`;
    }
    return '-';
  };

  // 最終ログイン日時をフォーマット
  const formatLastLogin = (timestamp) => {
    if (!timestamp) return '未ログイン';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('ja-JP');
  };

  // ユーザーの有効/無効を切り替え
  const toggleUserStatus = async (userId, currentStatus) => {
    // 自分自身は無効化できない
    if (userId === userInfo.id) {
      toast.error('自分自身のアカウントは無効化できません');
      return;
    }

    const action = currentStatus ? '無効化' : '有効化';
    if (!confirm(`このユーザーを${action}しますか？`)) return;

    try {
      const userRef = doc(db, 'companies', companyId, 'users', userId);
      await updateDoc(userRef, {
        isActive: !currentStatus
      });

      setUsers(prev => prev.map(u =>
        u.id === userId ? { ...u, isActive: !currentStatus } : u
      ));
      toast.success(`ユーザーを${action}しました`);
    } catch (error) {
      console.error('ステータス更新エラー:', error);
      toast.error('更新に失敗しました');
    }
  };

  // パスワードリセットメール送信
  const handlePasswordReset = async (email, userName) => {
    if (!confirm(`${userName}にパスワードリセットメールを送信しますか？`)) return;

    try {
      await resetPassword(email);
      toast.success('パスワードリセットメールを送信しました');
    } catch (error) {
      console.error('パスワードリセットエラー:', error);
      toast.error('パスワードリセットメールの送信に失敗しました');
    }
  };

  // 削除確認モーダルを開く
  const openDeleteModal = (user) => {
    setUserToDelete(user);
    setShowDeleteModal(true);
  };

  // ユーザー削除
  const handleDeleteUser = async () => {
    if (!userToDelete) return;

    setDeleting(true);
    try {
      const deleteUserFn = httpsCallable(functions, 'deleteUser');
      await deleteUserFn({
        targetUserId: userToDelete.id,
        companyId: companyId
      });

      // ローカルstateから削除
      setUsers(prev => prev.filter(u => u.id !== userToDelete.id));
      toast.success('ユーザーを削除しました');
      setShowDeleteModal(false);
      setUserToDelete(null);
    } catch (error) {
      console.error('ユーザー削除エラー:', error);
      toast.error(error.message || 'ユーザーの削除に失敗しました');
    } finally {
      setDeleting(false);
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center space-x-2">
          <Lock className="text-red-500" />
          <span>ユーザー管理</span>
        </h1>
        {isOfficeOrAbove() && (
          <Link
            to="/users/new"
            className="inline-flex items-center justify-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={20} />
            <span>新規登録</span>
          </Link>
        )}
      </div>

      {/* 説明 */}
      <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg">
        <p className="text-sm">
          <strong>管理者</strong>: 全ての機能にアクセス可能<br />
          <strong>事務員</strong>: 管理システムにアクセス可能、日報編集可能<br />
          <strong>現場管理者</strong>: 日報アプリのみ使用可能（管理画面アクセス不可）<br />
          <strong>作業員</strong>: 将来の拡張用（現在は未使用）
        </p>
      </div>

      {/* 検索 */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="表示名・メールアドレスで検索..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* テーブル */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {filteredUsers.length > 0 ? (
          <>
            {/* デスクトップ: テーブル表示 */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      表示名
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      メールアドレス
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      権限
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      紐付け社員
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      状態
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      最終ログイン
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                            <User size={16} className="text-gray-500" />
                          </div>
                          <span className="text-sm font-medium text-gray-900">
                            {user.displayName}
                            {user.id === userInfo.id && (
                              <span className="ml-2 text-xs text-gray-400">(自分)</span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {user.email}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <RoleBadge role={user.role} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {getEmployeeName(user.employeeId)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusBadge isActive={user.isActive} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatLastLogin(user.lastLoginAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="flex items-center space-x-3">
                          <Link
                            to={`/users/${user.id}`}
                            className="text-blue-600 hover:text-blue-800"
                            title="編集"
                          >
                            <Edit size={18} />
                          </Link>
                          {isOfficeOrAbove() && user.id !== userInfo.id && (
                            <>
                              <button
                                onClick={() => handlePasswordReset(user.email, user.displayName)}
                                className="text-purple-600 hover:text-purple-800"
                                title="パスワードリセット"
                              >
                                <Mail size={18} />
                              </button>
                              <button
                                onClick={() => toggleUserStatus(user.id, user.isActive)}
                                className={user.isActive ? 'text-orange-600 hover:text-orange-800' : 'text-green-600 hover:text-green-800'}
                                title={user.isActive ? '無効化' : '有効化'}
                              >
                                {user.isActive ? <UserX size={18} /> : <UserCheck size={18} />}
                              </button>
                              <button
                                onClick={() => openDeleteModal(user)}
                                className="text-red-600 hover:text-red-800"
                                title="削除"
                              >
                                <Trash2 size={18} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* モバイル: カード表示 */}
            <div className="md:hidden divide-y divide-gray-200">
              {filteredUsers.map((user) => (
                <Link
                  key={user.id}
                  to={`/users/${user.id}`}
                  className="block p-4 hover:bg-gray-50 active:bg-gray-100"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">
                      {user.displayName}
                      {user.id === userInfo.id && <span className="text-xs text-gray-400 ml-1">(自分)</span>}
                    </span>
                    <StatusBadge isActive={user.isActive} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 truncate mr-2">{user.email}</span>
                    <RoleBadge role={user.role} />
                  </div>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <div className="p-8 text-center text-gray-500">
            <Lock size={48} className="mx-auto mb-4 text-gray-300" />
            <p>ユーザーデータがありません</p>
          </div>
        )}
      </div>

      {/* 削除確認モーダル */}
      {showDeleteModal && userToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                  <Trash2 className="text-red-600" size={24} />
                </div>
                <h3 className="text-lg font-bold text-gray-800">ユーザーを削除</h3>
              </div>
              <p className="text-gray-600 mb-2">
                以下のユーザーを完全に削除しますか？
              </p>
              <div className="bg-gray-50 rounded-lg p-3 mb-4">
                <p className="font-medium text-gray-900">{userToDelete.displayName}</p>
                <p className="text-sm text-gray-500">{userToDelete.email}</p>
              </div>
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm mb-4">
                <strong>警告:</strong> この操作は取り消せません。ユーザーのアカウントとデータが完全に削除されます。
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowDeleteModal(false);
                    setUserToDelete(null);
                  }}
                  disabled={deleting}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleDeleteUser}
                  disabled={deleting}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {deleting ? '削除中...' : '削除する'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
