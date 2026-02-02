// src/pages/sites/SiteList.jsx
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
  MapPin,
  Calendar
} from 'lucide-react';
import CsvImportModal from '../../components/CsvImport/CsvImportModal';

// ステータスバッジ
function StatusBadge({ status }) {
  const styles = {
    active: 'bg-green-100 text-green-800',
    completed: 'bg-gray-100 text-gray-800',
    pending: 'bg-yellow-100 text-yellow-800'
  };

  const labels = {
    active: '進行中',
    completed: '完了',
    pending: '予定'
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.pending}`}>
      {labels[status] || status}
    </span>
  );
}

export default function SiteList() {
  const { companyId, isAdmin } = useAuth();
  
  const [sites, setSites] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showImportModal, setShowImportModal] = useState(false);
  const itemsPerPage = 10;

  // データ取得関数
  const fetchData = async () => {
    if (!companyId) return;
    try {
      // 現場データ取得
      const sitesRef = collection(db, 'companies', companyId, 'sites');
      const sitesQuery = query(sitesRef, orderBy('createdAt', 'desc'));
      const sitesSnapshot = await getDocs(sitesQuery);

      const sitesData = sitesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setSites(sitesData);

      // 取引先データ取得（フィルター用）
      const clientsRef = collection(db, 'companies', companyId, 'clients');
      const clientsSnapshot = await getDocs(clientsRef);
      const clientsData = clientsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setClients(clientsData);

    } catch (error) {
      console.error('データ取得エラー:', error);
    } finally {
      setLoading(false);
    }
  };

  // 初回データ取得
  useEffect(() => {
    fetchData();
  }, [companyId]);

  // フィルタリング
  const filteredSites = sites.filter(site => {
    const matchesSearch = (site.siteName || '').includes(searchTerm) ||
                          (site.address || '').includes(searchTerm);
    const matchesStatus = !filterStatus || site.status === filterStatus;
    const matchesClient = !filterClient || site.clientId === filterClient;
    return matchesSearch && matchesStatus && matchesClient;
  });

  // ページネーション
  const totalPages = Math.ceil(filteredSites.length / itemsPerPage);
  const paginatedSites = filteredSites.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // 削除処理
  const handleDelete = async (id, name) => {
    if (!confirm(`「${name}」を削除しますか？`)) return;
    
    try {
      await deleteDoc(doc(db, 'companies', companyId, 'sites', id));
      setSites(prev => prev.filter(s => s.id !== id));
    } catch (error) {
      console.error('削除エラー:', error);
      alert('削除に失敗しました');
    }
  };

  // 日付フォーマット
  const formatDate = (timestamp) => {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('ja-JP');
  };

  // CSVエクスポート
  const handleExport = () => {
    const headers = ['現場名', '取引先', '住所', '開始日', '終了日', 'ステータス'];
    const rows = filteredSites.map(site => [
      site.siteName || '',
      site.clientName || '',
      site.address || '',
      formatDate(site.startDate),
      formatDate(site.endDate),
      site.status || ''
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `現場一覧_${new Date().toLocaleDateString('ja-JP')}.csv`;
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
          <MapPin className="text-purple-500" />
          <span>現場管理</span>
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
              to="/sites/new"
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
              placeholder="現場名・住所で検索..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <select
            value={filterClient}
            onChange={(e) => setFilterClient(e.target.value)}
            className="border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">取引先</option>
            {clients.map(client => (
              <option key={client.id} value={client.id}>{client.clientName}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">ステータス</option>
            <option value="active">進行中</option>
            <option value="completed">完了</option>
            <option value="pending">予定</option>
          </select>
        </div>
      </div>

      {/* テーブル */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {filteredSites.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      現場名
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      取引先
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      工期
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      ステータス
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {paginatedSites.map((site) => (
                    <tr key={site.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {site.siteName}
                        </div>
                        <div className="text-sm text-gray-500">
                          {site.address}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {site.clientName || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <div className="flex items-center space-x-1">
                          <Calendar size={14} className="text-gray-400" />
                          <span>
                            {formatDate(site.startDate)} 〜 {formatDate(site.endDate)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusBadge status={site.status} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="flex items-center space-x-3">
                          <Link
                            to={`/sites/${site.id}`}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <Edit size={18} />
                          </Link>
                          {isAdmin() && (
                            <button
                              onClick={() => handleDelete(site.id, site.siteName)}
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
                {filteredSites.length}件中 {(currentPage - 1) * itemsPerPage + 1}-
                {Math.min(currentPage * itemsPerPage, filteredSites.length)}件を表示
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
            <MapPin size={48} className="mx-auto mb-4 text-gray-300" />
            <p>現場データがありません</p>
            {isAdmin() && (
              <Link
                to="/sites/new"
                className="inline-flex items-center space-x-2 text-blue-600 hover:text-blue-800 mt-4"
              >
                <Plus size={18} />
                <span>最初の現場を登録する</span>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* アクションボタン */}
      {filteredSites.length > 0 && (
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
        entityType="site"
        companyId={companyId}
        onComplete={(result) => {
          setShowImportModal(false);
          fetchData();
        }}
      />
    </div>
  );
}
