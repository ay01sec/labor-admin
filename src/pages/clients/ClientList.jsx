// src/pages/clients/ClientList.jsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
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
  Building2,
  Phone,
  Mail
} from 'lucide-react';
import CsvImportModal from '../../components/CsvImport/CsvImportModal';

export default function ClientList() {
  const { companyId, isAdmin } = useAuth();
  
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showImportModal, setShowImportModal] = useState(false);
  const itemsPerPage = 10;

  // データ取得関数
  const fetchClients = async () => {
    if (!companyId) return;
    try {
      const clientsRef = collection(db, 'companies', companyId, 'clients');
      const q = query(clientsRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);

      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setClients(data);
    } catch (error) {
      console.error('取引先データ取得エラー:', error);
    } finally {
      setLoading(false);
    }
  };

  // 初回データ取得
  useEffect(() => {
    fetchClients();
  }, [companyId]);

  // フィルタリング
  const filteredClients = clients.filter(client => {
    const matchesSearch = 
      (client.clientName || '').includes(searchTerm) ||
      (client.managerName || '').includes(searchTerm);
    return matchesSearch;
  });

  // ページネーション
  const totalPages = Math.ceil(filteredClients.length / itemsPerPage);
  const paginatedClients = filteredClients.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // 削除処理
  const handleDelete = async (id, name) => {
    if (!confirm(`「${name}」を削除しますか？`)) return;
    
    try {
      await deleteDoc(doc(db, 'companies', companyId, 'clients', id));
      setClients(prev => prev.filter(c => c.id !== id));
    } catch (error) {
      console.error('削除エラー:', error);
      alert('削除に失敗しました');
    }
  };

  // CSVエクスポート
  const handleExport = () => {
    const headers = ['取引先名', '担当者', 'TEL', 'Email', '住所'];
    const rows = filteredClients.map(client => [
      client.clientName || '',
      client.managerName || '',
      client.tel || '',
      client.email || '',
      `${client.prefecture || ''}${client.city || ''}${client.address || ''}`
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `取引先一覧_${new Date().toLocaleDateString('ja-JP')}.csv`;
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
          <Building2 className="text-green-500" />
          <span>取引先管理</span>
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
              to="/clients/new"
              className="inline-flex items-center justify-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus size={20} />
              <span>新規登録</span>
            </Link>
          </div>
        )}
      </div>

      {/* 検索 */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="取引先名・担当者名で検索..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* テーブル */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {filteredClients.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      取引先名
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      担当者
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      TEL
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {paginatedClients.map((client) => (
                    <tr key={client.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {client.clientName}
                        </div>
                        <div className="text-sm text-gray-500">
                          {client.prefecture}{client.city}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {client.managerName || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {client.tel ? (
                          <a href={`tel:${client.tel}`} className="flex items-center space-x-1 text-blue-600 hover:text-blue-800">
                            <Phone size={14} />
                            <span>{client.tel}</span>
                          </a>
                        ) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {client.email ? (
                          <a href={`mailto:${client.email}`} className="flex items-center space-x-1 text-blue-600 hover:text-blue-800">
                            <Mail size={14} />
                            <span>{client.email}</span>
                          </a>
                        ) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="flex items-center space-x-3">
                          <Link
                            to={`/clients/${client.id}`}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <Edit size={18} />
                          </Link>
                          {isAdmin() && (
                            <button
                              onClick={() => handleDelete(client.id, client.clientName)}
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
                {filteredClients.length}件中 {(currentPage - 1) * itemsPerPage + 1}-
                {Math.min(currentPage * itemsPerPage, filteredClients.length)}件を表示
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
            <Building2 size={48} className="mx-auto mb-4 text-gray-300" />
            <p>取引先データがありません</p>
            {isAdmin() && (
              <Link
                to="/clients/new"
                className="inline-flex items-center space-x-2 text-blue-600 hover:text-blue-800 mt-4"
              >
                <Plus size={18} />
                <span>最初の取引先を登録する</span>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* アクションボタン */}
      {filteredClients.length > 0 && (
        <div className="flex items-center space-x-4">
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
        entityType="client"
        companyId={companyId}
        onComplete={(result) => {
          setShowImportModal(false);
          fetchClients();
        }}
      />
    </div>
  );
}
