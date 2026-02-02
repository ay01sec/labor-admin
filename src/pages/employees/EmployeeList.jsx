// src/pages/employees/EmployeeList.jsx
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  collection,
  query,
  getDocs,
  orderBy,
  deleteDoc,
  doc
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Download,
  Upload,
  ChevronLeft,
  ChevronRight,
  Users,
  AlertCircle
} from 'lucide-react';
import CsvImportModal from '../../components/CsvImport/CsvImportModal';

// ステータスバッジ
function StatusBadge({ isActive }) {
  return isActive ? (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
      在籍
    </span>
  ) : (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
      退職
    </span>
  );
}

// 雇用形態バッジ
function EmploymentTypeBadge({ type }) {
  const styles = {
    '正社員': 'bg-blue-100 text-blue-800',
    '契約社員': 'bg-purple-100 text-purple-800',
    'パート': 'bg-orange-100 text-orange-800',
    'アルバイト': 'bg-yellow-100 text-yellow-800'
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[type] || 'bg-gray-100 text-gray-800'}`}>
      {type}
    </span>
  );
}

export default function EmployeeList() {
  const { companyId, isAdmin } = useAuth();
  const navigate = useNavigate();
  
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [showImportModal, setShowImportModal] = useState(false);
  const itemsPerPage = 10;

  // データ取得関数
  const fetchEmployees = async () => {
    if (!companyId) return;
    try {
      const employeesRef = collection(db, 'companies', companyId, 'employees');
      const q = query(employeesRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);

      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setEmployees(data);
    } catch (error) {
      console.error('社員データ取得エラー:', error);
    } finally {
      setLoading(false);
    }
  };

  // 初回データ取得
  useEffect(() => {
    fetchEmployees();
  }, [companyId]);

  // フィルタリング
  const filteredEmployees = employees.filter(emp => {
    const fullName = `${emp.lastName || ''}${emp.firstName || ''}`;
    const matchesSearch = fullName.includes(searchTerm) ||
                          (emp.lastNameKana + emp.firstNameKana).includes(searchTerm);
    const matchesType = !filterType || emp.employment?.type === filterType;
    const matchesStatus = filterStatus === '' ||
                          (filterStatus === 'active' && emp.isActive) ||
                          (filterStatus === 'inactive' && !emp.isActive);
    
    return matchesSearch && matchesType && matchesStatus;
  });

  // ページネーション
  const totalPages = Math.ceil(filteredEmployees.length / itemsPerPage);
  const paginatedEmployees = filteredEmployees.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // 選択処理
  const toggleSelectAll = () => {
    if (selectedIds.length === paginatedEmployees.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(paginatedEmployees.map(e => e.id));
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev =>
      prev.includes(id)
        ? prev.filter(i => i !== id)
        : [...prev, id]
    );
  };

  // 削除処理
  const handleDelete = async (id) => {
    if (!confirm('この社員を削除しますか？')) return;
    
    try {
      await deleteDoc(doc(db, 'companies', companyId, 'employees', id));
      setEmployees(prev => prev.filter(e => e.id !== id));
      setSelectedIds(prev => prev.filter(i => i !== id));
    } catch (error) {
      console.error('削除エラー:', error);
      alert('削除に失敗しました');
    }
  };

  // CSVエクスポート
  const handleExport = () => {
    const headers = ['氏名', '雇用形態', '入社日', '任務', '状態'];
    const rows = filteredEmployees.map(emp => [
      `${emp.lastName || ''} ${emp.firstName || ''}`,
      emp.employment?.type || '',
      emp.employment?.hireDate?.toDate?.()?.toLocaleDateString('ja-JP') || '',
      emp.employment?.role || '',
      emp.isActive ? '在籍' : '退職'
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `社員一覧_${new Date().toLocaleDateString('ja-JP')}.csv`;
    link.click();
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
          <Users className="text-blue-500" />
          <span>社員管理</span>
        </h1>
        {isAdmin() && (
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowImportModal(true)}
              className="inline-flex items-center justify-center space-x-2 border border-blue-600 text-blue-600 px-4 py-2 rounded-lg hover:bg-blue-50 transition-colors"
            >
              <Upload size={20} />
              <span>CSVインポート</span>
            </button>
            <Link
              to="/employees/new"
              className="inline-flex items-center justify-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus size={20} />
              <span>新規登録</span>
            </Link>
          </div>
        )}
      </div>

      {/* 検索・フィルター */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="氏名で検索..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">雇用形態</option>
            <option value="正社員">正社員</option>
            <option value="契約社員">契約社員</option>
            <option value="パート">パート</option>
            <option value="アルバイト">アルバイト</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">在籍状況</option>
            <option value="active">在籍</option>
            <option value="inactive">退職</option>
          </select>
        </div>
      </div>

      {/* テーブル */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {filteredEmployees.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    {isAdmin() && (
                      <th className="px-6 py-3 text-left">
                        <input
                          type="checkbox"
                          checked={selectedIds.length === paginatedEmployees.length && paginatedEmployees.length > 0}
                          onChange={toggleSelectAll}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </th>
                    )}
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      氏名
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      雇用形態
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      入社日
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      任務
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      状態
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {paginatedEmployees.map((employee) => (
                    <tr key={employee.id} className="hover:bg-gray-50">
                      {isAdmin() && (
                        <td className="px-6 py-4">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(employee.id)}
                            onChange={() => toggleSelect(employee.id)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                        </td>
                      )}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {employee.lastName} {employee.firstName}
                          </div>
                          <div className="text-sm text-gray-500">
                            {employee.lastNameKana} {employee.firstNameKana}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <EmploymentTypeBadge type={employee.employment?.type} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {employee.employment?.hireDate?.toDate?.()?.toLocaleDateString('ja-JP') || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {employee.employment?.role || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusBadge isActive={employee.isActive} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="flex items-center space-x-3">
                          <Link
                            to={`/employees/${employee.id}`}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <Edit size={18} />
                          </Link>
                          {isAdmin() && (
                            <button
                              onClick={() => handleDelete(employee.id)}
                              className="text-red-600 hover:text-red-800"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ページネーション */}
            <div className="px-6 py-4 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-sm text-gray-500">
                {filteredEmployees.length}件中 {(currentPage - 1) * itemsPerPage + 1}-
                {Math.min(currentPage * itemsPerPage, filteredEmployees.length)}件を表示
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="px-4 py-1 text-sm">
                  {currentPage} / {totalPages || 1}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages || totalPages === 0}
                  className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="p-8 text-center text-gray-500">
            <Users size={48} className="mx-auto mb-4 text-gray-300" />
            <p>社員データがありません</p>
            {isAdmin() && (
              <Link
                to="/employees/new"
                className="inline-flex items-center space-x-2 text-blue-600 hover:text-blue-800 mt-4"
              >
                <Plus size={18} />
                <span>最初の社員を登録する</span>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* アクションボタン */}
      {filteredEmployees.length > 0 && (
        <div className="flex items-center space-x-4">
          {isAdmin() && selectedIds.length > 0 && (
            <button
              onClick={() => {
                if (confirm(`${selectedIds.length}件の社員を削除しますか？`)) {
                  // 一括削除処理
                }
              }}
              className="text-red-600 hover:text-red-800 text-sm flex items-center space-x-1"
            >
              <Trash2 size={16} />
              <span>一括削除 ({selectedIds.length}件)</span>
            </button>
          )}
          <button
            onClick={handleExport}
            className="text-blue-600 hover:text-blue-800 text-sm flex items-center space-x-1"
          >
            <Download size={16} />
            <span>CSVエクスポート</span>
          </button>
        </div>
      )}

      {/* CSVインポートモーダル */}
      <CsvImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        entityType="employee"
        companyId={companyId}
        onComplete={(result) => {
          setShowImportModal(false);
          fetchEmployees();
        }}
      />
    </div>
  );
}
