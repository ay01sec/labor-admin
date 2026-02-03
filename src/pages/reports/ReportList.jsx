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
  Download,
} from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import toast from 'react-hot-toast';

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

  // CSV出力用
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvDateRange, setCsvDateRange] = useState(() => {
    const now = new Date();
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      startDate: prevMonthStart.toISOString().split('T')[0],
      endDate: prevMonthEnd.toISOString().split('T')[0],
    };
  });
  const [csvEmployeeFilter, setCsvEmployeeFilter] = useState('');
  const [csvLoading, setCsvLoading] = useState(false);
  const [employees, setEmployees] = useState([]);

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

        // 従業員一覧取得（CSVフィルター用）
        const employeesRef = collection(db, 'companies', companyId, 'employees');
        const employeesSnapshot = await getDocs(employeesRef);
        const employeesData = employeesSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setEmployees(employeesData);

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

  // CSV出力
  const handleCsvExport = async () => {
    setCsvLoading(true);
    try {
      const startDate = new Date(csvDateRange.startDate);
      const endDate = new Date(csvDateRange.endDate + 'T23:59:59');

      const reportsRef = collection(db, 'companies', companyId, 'dailyReports');
      const snapshot = await getDocs(reportsRef);

      const targetReports = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((report) => {
          if (!report.reportDate) return false;
          const reportDate = report.reportDate.toDate
            ? report.reportDate.toDate()
            : new Date(report.reportDate);
          return reportDate >= startDate && reportDate <= endDate;
        })
        .sort((a, b) => {
          const dateA = a.reportDate?.toDate ? a.reportDate.toDate() : new Date(a.reportDate);
          const dateB = b.reportDate?.toDate ? b.reportDate.toDate() : new Date(b.reportDate);
          return dateA - dateB;
        });

      const statusLabels = {
        draft: '下書き',
        signed: 'サイン済み',
        submitted: '送信完了',
        approved: '承認済み',
        rejected: '差戻し',
      };

      const headers = [
        '実施日', '現場名', '作成者', '作業員名', '開始時間', '終了時間',
        '昼休憩', '備考', 'ステータス', '送信日時', '承認日時',
      ];

      const rows = [];
      for (const report of targetReports) {
        const workers = report.workers || [];
        const reportDate = report.reportDate?.toDate
          ? report.reportDate.toDate()
          : new Date(report.reportDate);
        const dateStr = reportDate.toLocaleDateString('ja-JP');

        const submittedStr = report.submittedAt
          ? (report.submittedAt.toDate
              ? report.submittedAt.toDate()
              : new Date(report.submittedAt)
            ).toLocaleString('ja-JP')
          : '';
        const approvedStr = report.approval?.approvedAt
          ? (report.approval.approvedAt.toDate
              ? report.approval.approvedAt.toDate()
              : new Date(report.approval.approvedAt)
            ).toLocaleString('ja-JP')
          : '';

        if (workers.length === 0) {
          // 作業員がいない場合も1行出力
          if (!csvEmployeeFilter) {
            rows.push([
              dateStr, report.siteName || '', report.createdByName || '',
              '', '', '', '', '',
              statusLabels[report.status] || report.status,
              submittedStr, approvedStr,
            ]);
          }
        } else {
          for (const worker of workers) {
            if (csvEmployeeFilter && worker.employeeId !== csvEmployeeFilter) continue;

            rows.push([
              dateStr,
              report.siteName || '',
              report.createdByName || '',
              worker.name || '',
              worker.startTime || '',
              worker.endTime || '',
              worker.noLunchBreak ? 'なし' : 'あり',
              `"${(worker.remarks || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
              statusLabels[report.status] || report.status,
              submittedStr,
              approvedStr,
            ]);
          }
        }
      }

      if (rows.length === 0) {
        toast.error('該当するデータがありません');
        setCsvLoading(false);
        return;
      }

      const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `日報一覧_${csvDateRange.startDate}_${csvDateRange.endDate}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);

      toast.success('CSVをダウンロードしました');
      setShowCsvModal(false);
    } catch (error) {
      console.error('CSV出力エラー:', error);
      toast.error('CSV出力に失敗しました');
    } finally {
      setCsvLoading(false);
    }
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
        <button
          onClick={() => setShowCsvModal(true)}
          className="inline-flex items-center justify-center space-x-2 border border-blue-600 text-blue-600 px-4 py-2 rounded-lg hover:bg-blue-50 transition-colors"
        >
          <Download size={20} />
          <span>CSV出力</span>
        </button>
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

      {/* CSV出力モーダル */}
      {showCsvModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
            <div className="p-6 space-y-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <Download className="text-blue-600" size={20} />
                </div>
                <h3 className="text-lg font-bold text-gray-800">日報CSV出力</h3>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">開始日</label>
                  <input
                    type="date"
                    value={csvDateRange.startDate}
                    onChange={(e) => setCsvDateRange((prev) => ({ ...prev, startDate: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">終了日</label>
                  <input
                    type="date"
                    value={csvDateRange.endDate}
                    onChange={(e) => setCsvDateRange((prev) => ({ ...prev, endDate: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">従業員</label>
                <select
                  value={csvEmployeeFilter}
                  onChange={(e) => setCsvEmployeeFilter(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">全員</option>
                  {employees
                    .filter((e) => e.isActive !== false)
                    .sort((a, b) => (a.lastName || '').localeCompare(b.lastName || ''))
                    .map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.lastName} {emp.firstName}
                      </option>
                    ))}
                </select>
              </div>

              <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
                <p>作業員が複数いる日報は、作業員ごとに1行ずつ出力されます。</p>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowCsvModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleCsvExport}
                  disabled={csvLoading}
                  className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  <Download size={18} />
                  <span>{csvLoading ? 'エクスポート中...' : 'ダウンロード'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
