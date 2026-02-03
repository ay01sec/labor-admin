// src/pages/Dashboard.jsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  Timestamp
} from 'firebase/firestore';
import { db } from '../services/firebase';
import {
  Users,
  Building2,
  MapPin,
  FileText,
  Bell,
  TrendingUp,
  Clock,
  CheckCircle,
  AlertCircle,
  ChevronRight
} from 'lucide-react';

// サマリーカード
function SummaryCard({ icon: Icon, label, value, subValue, color, to }) {
  return (
    <Link
      to={to}
      className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow"
    >
      <div className="flex items-center space-x-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="text-white" size={24} />
        </div>
        <div className="flex-1">
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-800">{value}</p>
          {subValue && <p className="text-xs text-gray-400">{subValue}</p>}
        </div>
        <ChevronRight className="text-gray-300" size={20} />
      </div>
    </Link>
  );
}

// 日報ステータスバッジ
function StatusBadge({ status }) {
  const styles = {
    approved: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    draft: 'bg-gray-100 text-gray-800'
  };

  const labels = {
    approved: '承認済',
    pending: '承認待ち',
    draft: '下書き'
  };

  const icons = {
    approved: CheckCircle,
    pending: Clock,
    draft: FileText
  };

  const Icon = icons[status] || FileText;

  return (
    <span className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium ${styles[status] || styles.draft}`}>
      <Icon size={12} />
      <span>{labels[status] || status}</span>
    </span>
  );
}

export default function Dashboard() {
  const { companyId, isAdmin } = useAuth();
  const [stats, setStats] = useState({
    employees: 0,
    clients: 0,
    sites: 0,
    pendingReports: 0
  });
  const [todayProgress, setTodayProgress] = useState({ submitted: 0, total: 0 });
  const [recentReports, setRecentReports] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) return;

    const fetchData = async () => {
      try {
        // 社員数取得
        const employeesSnap = await getDocs(
          query(
            collection(db, 'companies', companyId, 'employees'),
            where('isActive', '==', true)
          )
        );

        // 取引先数取得
        const clientsSnap = await getDocs(
          collection(db, 'companies', companyId, 'clients')
        );

        // 稼働中の現場数取得
        const sitesSnap = await getDocs(
          query(
            collection(db, 'companies', companyId, 'sites'),
            where('status', '==', 'active')
          )
        );

        // 承認待ち日報数取得
        const pendingReportsSnap = await getDocs(
          query(
            collection(db, 'companies', companyId, 'dailyReports'),
            where('status', '==', 'submitted')
          )
        );

        setStats({
          employees: employeesSnap.size,
          clients: clientsSnap.size,
          sites: sitesSnap.size,
          pendingReports: pendingReportsSnap.size
        });

        // 今日の日報提出状況
        const activeSites = sitesSnap.docs.map(d => d.id);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStart = Timestamp.fromDate(today);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const todayEnd = Timestamp.fromDate(tomorrow);

        const todayReportsSnap = await getDocs(
          query(
            collection(db, 'companies', companyId, 'dailyReports'),
            where('reportDate', '>=', todayStart),
            where('reportDate', '<', todayEnd)
          )
        );

        const submittedSiteIds = new Set();
        todayReportsSnap.docs.forEach(d => {
          const data = d.data();
          if (data.status === 'submitted' || data.status === 'approved') {
            submittedSiteIds.add(data.siteId);
          }
        });

        setTodayProgress({
          submitted: submittedSiteIds.size,
          total: activeSites.length,
        });

        // 最近の日報取得
        const recentReportsSnap = await getDocs(
          query(
            collection(db, 'companies', companyId, 'dailyReports'),
            orderBy('createdAt', 'desc'),
            limit(5)
          )
        );

        const reports = recentReportsSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setRecentReports(reports);

        // お知らせ（仮のデータ）
        setNotifications([
          { id: 1, message: '承認待ちの日報が' + pendingReportsSnap.size + '件あります', type: 'warning' },
        ]);

      } catch (error) {
        console.error('データ取得エラー:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [companyId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">ダッシュボード</h1>

      {/* サマリーカード */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          icon={Users}
          label="社員"
          value={`${stats.employees}名`}
          subValue="在籍中"
          color="bg-blue-500"
          to="/employees"
        />
        <SummaryCard
          icon={Building2}
          label="取引先"
          value={`${stats.clients}社`}
          color="bg-green-500"
          to="/clients"
        />
        <SummaryCard
          icon={MapPin}
          label="現場"
          value={`${stats.sites}件`}
          subValue="稼働中"
          color="bg-purple-500"
          to="/sites"
        />
        <SummaryCard
          icon={FileText}
          label="日報"
          value={`未承認: ${stats.pendingReports}`}
          color="bg-orange-500"
          to="/reports"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 今日の日報状況 */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center space-x-2">
              <TrendingUp size={20} className="text-blue-500" />
              <span>今日の日報状況</span>
            </h2>
          </div>
          <div className="mb-2">
            <div className="flex justify-between text-sm text-gray-600 mb-1">
              <span>提出済み: {todayProgress.submitted} / {todayProgress.total} 現場</span>
              <span>{todayProgress.total > 0 ? Math.round((todayProgress.submitted / todayProgress.total) * 100) : 0}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-4">
              <div
                className={`h-4 rounded-full transition-all duration-500 ${
                  todayProgress.total > 0 && todayProgress.submitted === todayProgress.total
                    ? 'bg-green-500'
                    : 'bg-blue-500'
                }`}
                style={{ width: `${todayProgress.total > 0 ? Math.round((todayProgress.submitted / todayProgress.total) * 100) : 0}%` }}
              />
            </div>
          </div>
          <p className="text-sm text-gray-500">
            今日の稼働現場に対する日報提出率
          </p>
        </div>

        {/* お知らせ */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center space-x-2 mb-4">
            <Bell size={20} className="text-orange-500" />
            <span>お知らせ</span>
          </h2>
          {notifications.length > 0 ? (
            <ul className="space-y-3">
              {notifications.map((note) => (
                <li key={note.id} className="flex items-start space-x-2 text-sm">
                  <AlertCircle
                    size={16}
                    className={`flex-shrink-0 mt-0.5 ${
                      note.type === 'warning' ? 'text-orange-500' : 'text-blue-500'
                    }`}
                  />
                  <span className="text-gray-600">{note.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-400 text-sm">お知らせはありません</p>
          )}
        </div>
      </div>

      {/* 最近の日報 */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center space-x-2">
              <FileText size={20} className="text-gray-500" />
              <span>最近の日報</span>
            </h2>
            <Link
              to="/reports"
              className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center space-x-1"
            >
              <span>すべて表示</span>
              <ChevronRight size={16} />
            </Link>
          </div>
        </div>

        {recentReports.length > 0 ? (
          <>
            {/* デスクトップ: テーブル表示 */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      日付
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      現場名
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      作成者
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
                  {recentReports.map((report) => (
                    <tr key={report.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {report.workDate?.toDate?.()?.toLocaleDateString('ja-JP') || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {report.siteName || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {report.createdByName || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusBadge status={report.status} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <Link
                          to={`/reports/${report.id}`}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          詳細
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* モバイル: カード表示 */}
            <div className="md:hidden divide-y divide-gray-200">
              {recentReports.map((report) => (
                <Link
                  key={report.id}
                  to={`/reports/${report.id}`}
                  className="block p-4 hover:bg-gray-50 active:bg-gray-100"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-900">{report.siteName || '-'}</span>
                    <StatusBadge status={report.status} />
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {report.createdByName || '-'} - {report.workDate?.toDate?.()?.toLocaleDateString('ja-JP') || '-'}
                  </div>
                </Link>
              ))}
            </div>
          </>

        ) : (
          <div className="p-8 text-center text-gray-500">
            <FileText size={48} className="mx-auto mb-4 text-gray-300" />
            <p>日報データがありません</p>
            <p className="text-sm mt-1">日報アプリから送信されたデータがここに表示されます</p>
          </div>
        )}
      </div>
    </div>
  );
}
