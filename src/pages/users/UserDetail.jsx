// src/pages/users/UserDetail.jsx
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
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { db, auth } from '../../services/firebase';
import {
  Save,
  ArrowLeft,
  Lock,
  AlertCircle,
  Eye,
  EyeOff,
  Info
} from 'lucide-react';

export default function UserDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { companyId, userInfo, isAdmin } = useAuth();
  const isNew = id === 'new';
  const isSelf = id === userInfo?.id;

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [employees, setEmployees] = useState([]);
  const [showPassword, setShowPassword] = useState(false);

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    displayName: '',
    role: 'operator',
    employeeId: '',
    isActive: true
  });

  // データ取得
  useEffect(() => {
    if (!companyId) return;

    const fetchData = async () => {
      try {
        // 社員データ取得
        const employeesRef = collection(db, 'companies', companyId, 'employees');
        const employeesSnapshot = await getDocs(employeesRef);
        const employeesData = employeesSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setEmployees(employeesData);

        // ユーザーデータ取得（編集時）
        if (!isNew) {
          const docRef = doc(db, 'companies', companyId, 'users', id);
          const docSnap = await getDoc(docRef);

          if (docSnap.exists()) {
            const data = docSnap.data();
            setFormData({
              email: data.email || '',
              password: '', // パスワードは表示しない
              displayName: data.displayName || '',
              role: data.role || 'operator',
              employeeId: data.employeeId || '',
              isActive: data.isActive !== false
            });
          } else {
            setError('ユーザーが見つかりません');
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
  };

  // 保存処理
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.displayName.trim()) {
      setError('表示名は必須です');
      return;
    }

    if (isNew) {
      if (!formData.email.trim()) {
        setError('メールアドレスは必須です');
        return;
      }
      if (!formData.password || formData.password.length < 6) {
        setError('パスワードは6文字以上で入力してください');
        return;
      }
    }

    setSaving(true);
    setError('');

    try {
      if (isNew) {
        // 新規ユーザー作成
        // Firebase Authenticationにユーザー作成
        const userCredential = await createUserWithEmailAndPassword(
          auth,
          formData.email,
          formData.password
        );
        const newUserId = userCredential.user.uid;

        // Firestoreにユーザードキュメント作成
        const userDocRef = doc(db, 'companies', companyId, 'users', newUserId);
        await setDoc(userDocRef, {
          email: formData.email,
          displayName: formData.displayName,
          role: formData.role,
          employeeId: formData.employeeId || null,
          isActive: true,
          lastLoginAt: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        // 注意: 新しいユーザーを作成すると、現在のユーザーがログアウトされる可能性がある
        // そのため、Admin SDKを使用するのが理想的だが、クライアント側では制限がある
        alert('ユーザーを作成しました。ページを再読み込みしてログインし直してください。');
        window.location.href = '/login';
        return;

      } else {
        // 既存ユーザー更新
        const dataToUpdate = {
          displayName: formData.displayName,
          employeeId: formData.employeeId || null,
          updatedAt: serverTimestamp()
        };

        // 自分自身の権限は変更できない
        if (!isSelf) {
          dataToUpdate.role = formData.role;
          dataToUpdate.isActive = formData.isActive;
        }

        const docRef = doc(db, 'companies', companyId, 'users', id);
        await updateDoc(docRef, dataToUpdate);
      }

      navigate('/users');
    } catch (error) {
      console.error('保存エラー:', error);
      
      if (error.code === 'auth/email-already-in-use') {
        setError('このメールアドレスは既に使用されています');
      } else if (error.code === 'auth/invalid-email') {
        setError('メールアドレスの形式が正しくありません');
      } else if (error.code === 'auth/weak-password') {
        setError('パスワードが弱すぎます。6文字以上にしてください');
      } else {
        setError('保存に失敗しました: ' + error.message);
      }
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
            to="/users"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center space-x-2">
            <Lock className="text-red-500" />
            <span>{isNew ? 'ユーザー登録' : formData.displayName}</span>
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

      {/* 自分自身の編集時の注意 */}
      {isSelf && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-lg flex items-start space-x-2">
          <Info size={20} className="flex-shrink-0 mt-0.5" />
          <span>自分自身のアカウントを編集中です。権限・状態の変更はできません。</span>
        </div>
      )}

      {/* 新規作成時の注意 */}
      {isNew && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-lg flex items-start space-x-2">
          <Info size={20} className="flex-shrink-0 mt-0.5" />
          <span>ユーザーを作成すると、現在のセッションがログアウトされます。作成後は再度ログインしてください。</span>
        </div>
      )}

      {/* フォーム */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* アカウント情報 */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">アカウント情報</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  メールアドレス {isNew && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder="user@example.com"
                  disabled={!isNew}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  required={isNew}
                />
                {!isNew && (
                  <p className="text-xs text-gray-500 mt-1">メールアドレスは変更できません</p>
                )}
              </div>
              
              {isNew && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    パスワード <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={formData.password}
                      onChange={(e) => handleChange('password', e.target.value)}
                      placeholder="6文字以上"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-12"
                      required
                      minLength={6}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  表示名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.displayName}
                  onChange={(e) => handleChange('displayName', e.target.value)}
                  placeholder="山田 太郎"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
            </div>
          </div>

          <hr />

          {/* 権限設定 */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">権限設定</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">権限</label>
                <select
                  value={formData.role}
                  onChange={(e) => handleChange('role', e.target.value)}
                  disabled={isSelf}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                >
                  <option value="admin">管理者</option>
                  <option value="operator">オペレーター</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">紐付け社員</label>
                <select
                  value={formData.employeeId}
                  onChange={(e) => handleChange('employeeId', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">紐付けなし</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.lastName} {emp.firstName}
                    </option>
                  ))}
                </select>
              </div>
              {!isNew && !isSelf && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">状態</label>
                  <select
                    value={formData.isActive ? 'active' : 'inactive'}
                    onChange={(e) => handleChange('isActive', e.target.value === 'active')}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="active">有効</option>
                    <option value="inactive">無効</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* 権限の説明 */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="font-medium text-gray-800 mb-2">権限の違い</h3>
            <div className="text-sm text-gray-600 space-y-1">
              <p><strong>管理者:</strong> 全ての機能にアクセス可能（マスタ管理、ユーザー管理、設定など）</p>
              <p><strong>オペレーター:</strong> 日報の入力・閲覧、マスタデータの閲覧のみ可能</p>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
