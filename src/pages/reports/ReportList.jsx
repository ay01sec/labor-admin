// src/pages/reports/ReportList.jsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  collection,
  getDocs,
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import {
  Search,
  FileText,
  ChevronLeft,
  ChevronRight,
  Eye,
  Calendar,
} from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

// ステータスバッジ
function StatusBadge({ status }) {
  const config = {
    draft: { label: '下書き', color: 'bg-gray-100 text-gray-600' },
    signed: { label: 'サイン済み', color: 'bg-yellow-100 text-yellow-700' },
    submitted: { label: '送信完了', color: 'bg-blue-100 text-blue-700' },
    approved: { label: '承認済み', color: 'bg-green-100 text-green-700' },
    rejected: { label: '差戻し', color: 'bg-red-100 text-red-700' },
  };

  const { label, color } = config[status] || { label: status, color: 'bg-gray-100 text-gray-600' };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

export default function ReportList() {
  const { companyId } = useAuth();

  const [reports, setReports] = useState([]);
  const [users, setUsers] = useState({});
  const [sites, setSites] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSite, setFilterSite] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // データ取得
  useEffect(() => {
    if (!companyId) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        // ユーザー一覧取得
        const usersRef = collection(db, 'companies', companyId, 'users');
        const usersSnapshot = await getDocs(usersRef);
        const usersMap = {};
        usersSnapshot.docs.forEach((doc) => {
          usersMap[doc.id] = doc.data();
        });
        setUsers(usersMap);

        // 現場一覧取得
        const sitesRef = collection(db, 'companies', companyId, 'sites');
        const sitesSnapshot = await getDocs(sitesRef);
        const sitesMap = {};
        sitesSnapshot.docs.forEach((doc) => {
          sitesMap[doc.id] = doc.data();
        });
        setSites(sitesMap);

        // 日報取得（インデックス問題回避のためシンプルなクエリ）
        const [year, month] = selectedMonth.split('-').map(Number);
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        const reportsRef = collection(db, 'companies', companyId, 'dailyReports');
        const snapshot = await getDocs(reportsRef);

        // クライアント側で日付フィルタリングとソートを行う
        const data = snapshot.docs
          .map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }))
          .filter((report) => {
            if (!report.reportDate) return false;
            const reportDate = report.reportDate.toDate ? report.reportDate.toDate() : new Date(report.reportDate);
            return reportDate >= startDate && reportDate <= endDate;
          })
          .sort((a, b) => {
            const dateA = a.reportDate?.toDate ? a.reportDate.toDate() : new Date(a.reportDate);
            const dateB = b.reportDate?.toDate ? b.reportDate.toDate() : new Date(b.reportDate);
            return dateB - dateA; // 降順
          });

        setReports(data);
      } catch (error) {
        console.error('データ取得エラー:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [companyId, selectedMonth]);

  // フィルタリング
  const filteredReports = reports.filter((report) => {
    const matchesSearch =
      !searchTerm ||
      report.siteName?.includes(searchTerm) ||
      report.createdByName?.includes(searchTerm);
    const matchesStatus = !filterStatus || report.status === filterStatus;
    const matchesSite = !filterSite || report.siteId === filterSite;

    return matchesSearch && matchesStatus && matchesSite;
  });

  // ページネーション
  const totalPages = Math.ceil(filteredReports.length / itemsPerPage);
  const paginatedReports = filteredReports.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // 月選択オプション生成
  const generateMonthOptions = () => {
    const options = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const label = `${date.getFullYear()}年${date.getMonth() + 1}月`;
      options.push({ value, label });
    }
    return options;
  };

  // 日付フォーマット
  const formatDate = (timestamp) => {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return format(date, 'M月d日(E)', { locale: ja });
  };

  const formatDateTime = (timestamp) => {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return format(date, 'M/d HH:mm', { locale: ja });
  };

  // 現場リスト（フィルター用）
  const siteList = Object.entries(sites).map(([id, data]) => ({
    id,
    name: data.siteName,
  }));

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
          <FileText className="text-blue-500" />
          <span>日報管理</span>
        </h1>
      </div>

      {/* 検索・フィルター */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="現場名・作成者で検索..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={selectedMonth}
              onChange={(e) => {
                setSelectedMonth(e.target.value);
                setCurrentPage(1);
              }}
              className="border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {generateMonthOptions().map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              value={filterSite}
              onChange={(e) => setFilterSite(e.target.value)}
              className="border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">全ての現場</option>
              {siteList.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">全てのステータス</option>
              <option value="draft">下書き</option>
              <option value="signed">サイン済み</option>
              <option value="submitted">送信完了</option>
              <option value="approved">承認済み</option>
              <option value="rejected">差戻し</option>
            </select>
          </div>
        </div>
      </div>

      {/* 統計 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {[
          { status: 'submitted', label: '承認待ち', color: 'blue' },
          { status: 'approved', label: '承認済み', color: 'green' },
          { status: 'rejected', label: '差戻し', color: 'red' },
          { status: 'signed', label: 'サイン済み', color: 'yellow' },
          { status: 'draft', label: '下書き', color: 'gray' },
        ].map(({ status, label, color }) => {
          const count = reports.filter((r) => r.status === status).length;
          return (
            <div
              key={status}
              className={`bg-${color}-50 border border-${color}-200 rounded-lg p-4 text-center cursor-pointer hover:shadow-sm transition-shadow`}
              onClick={() => setFilterStatus(filterStatus === status ? '' : status)}
            >
              <div className={`text-2xl font-bold text-${color}-600`}>{count}</div>
              <div className={`text-sm text-${color}-700`}>{label}</div>
            </div>
          );
        })}
      </div>

      {/* テーブル */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {filteredReports.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      実施日
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      現場名
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      作成者
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      作業員数
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      送信日時
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
                  {paginatedReports.map((report) => (
                    <tr key={report.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <Calendar size={16} className="text-gray-400" />
                          <span className="text-sm font-medium text-gray-900">
                            {formatDate(report.reportDate)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {report.siteName || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {report.createdByName || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {report.workers?.length || 0}名
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDateTime(report.submittedAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusBadge status={report.status} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <Link
                          to={`/reports/${report.id}`}
                          className="text-blue-600 hover:text-blue-800 flex items-center space-x-1"
                        >
                          <Eye size={18} />
                          <span>詳細</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ページネーション */}
            <div className="px-6 py-4 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-sm text-gray-500">
                {filteredReports.length}件中 {(currentPage - 1) * itemsPerPage + 1}-
                {Math.min(currentPage * itemsPerPage, filteredReports.length)}件を表示
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="px-4 py-1 text-sm">
                  {currentPage} / {totalPages || 1}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
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
            <FileText size={48} className="mx-auto mb-4 text-gray-300" />
            <p>日報データがありません</p>
          </div>
        )}
      </div>
    </div>
  );
}
