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
import { db } from '../../services/firebase';
import {
  Plus,
  Search,
  Edit,
  Lock,
  UserCheck,
  UserX,
  Shield,
  User
} from 'lucide-react';

// 権限バッジ
function RoleBadge({ role }) {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
        <Shield size={12} />
        <span>管理者</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
      <User size={12} />
      <span>オペレーター</span>
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
  const { companyId, userInfo, isAdmin } = useAuth();
  
  const [users, setUsers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

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
      alert('自分自身のアカウントは無効化できません');
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
    } catch (error) {
      console.error('ステータス更新エラー:', error);
      alert('更新に失敗しました');
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
        {isAdmin() && (
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
          <strong>オペレーター</strong>: 日報の入力・閲覧、マスタデータの閲覧のみ可能
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
          <div className="overflow-x-auto">
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
                        >
                          <Edit size={18} />
                        </Link>
                        {isAdmin() && user.id !== userInfo.id && (
                          <button
                            onClick={() => toggleUserStatus(user.id, user.isActive)}
                            className={user.isActive ? 'text-orange-600 hover:text-orange-800' : 'text-green-600 hover:text-green-800'}
                            title={user.isActive ? '無効化' : '有効化'}
                          >
                            {user.isActive ? <UserX size={18} /> : <UserCheck size={18} />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            <Lock size={48} className="mx-auto mb-4 text-gray-300" />
            <p>ユーザーデータがありません</p>
          </div>
        )}
      </div>
    </div>
  );
}
