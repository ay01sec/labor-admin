import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { Clock, Download } from 'lucide-react';

export default function AttendanceSummary() {
  const { companyId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [summaryData, setSummaryData] = useState([]);
  const [employees, setEmployees] = useState([]);

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

  // 労働時間計算 (startTime, endTime -> hours)
  const calcWorkHours = (startTime, endTime, noLunchBreak) => {
    if (!startTime || !endTime) return 0;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
    const lunchMinutes = noLunchBreak ? 0 : 60;
    return Math.max(0, (totalMinutes - lunchMinutes) / 60);
  };

  useEffect(() => {
    if (!companyId) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        // 従業員取得
        const empSnap = await getDocs(
          query(collection(db, 'companies', companyId, 'employees'), where('isActive', '==', true))
        );
        const empList = empSnap.docs.map(d => ({
          id: d.id,
          ...d.data(),
          fullName: `${d.data().lastName || ''}${d.data().firstName || ''}`,
        }));
        setEmployees(empList);

        // 該当月の日報取得（承認済み + 提出済み）
        const [year, month] = selectedMonth.split('-').map(Number);
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        const reportsSnap = await getDocs(
          collection(db, 'companies', companyId, 'dailyReports')
        );

        const reports = reportsSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(r => {
            if (!r.reportDate) return false;
            const rd = r.reportDate.toDate ? r.reportDate.toDate() : new Date(r.reportDate);
            return rd >= startDate && rd <= endDate
              && (r.status === 'submitted' || r.status === 'approved');
          });

        // 従業員別集計
        const summaryMap = {};
        for (const report of reports) {
          const reportDate = report.reportDate?.toDate
            ? report.reportDate.toDate()
            : new Date(report.reportDate);
          const dateStr = `${reportDate.getFullYear()}-${String(reportDate.getMonth() + 1).padStart(2, '0')}-${String(reportDate.getDate()).padStart(2, '0')}`;

          for (const worker of (report.workers || [])) {
            const key = worker.employeeId || worker.name;
            if (!key) continue;

            if (!summaryMap[key]) {
              summaryMap[key] = {
                employeeId: worker.employeeId,
                name: worker.name,
                dates: new Set(),
                totalHours: 0,
                noLunchDays: 0,
              };
            }

            summaryMap[key].dates.add(dateStr);
            summaryMap[key].totalHours += calcWorkHours(worker.startTime, worker.endTime, worker.noLunchBreak);
            if (worker.noLunchBreak) {
              summaryMap[key].noLunchDays += 1;
            }
          }
        }

        const summary = Object.values(summaryMap)
          .map(s => ({
            ...s,
            workDays: s.dates.size,
          }))
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        setSummaryData(summary);
      } catch (error) {
        console.error('勤怠集計エラー:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [companyId, selectedMonth]);

  const exportCSV = () => {
    const headers = ['氏名', '出勤日数', '総労働時間', '昼休憩なし日数'];
    const rows = summaryData.map(s => [
      s.name,
      s.workDays,
      s.totalHours.toFixed(1),
      s.noLunchDays,
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.join(','))
      .join('\n');

    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `勤怠集計_${selectedMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center space-x-2">
          <Clock className="text-gray-500" />
          <span>勤怠集計</span>
        </h1>
        <div className="flex items-center space-x-3">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
          >
            {generateMonthOptions().map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            onClick={exportCSV}
            disabled={summaryData.length === 0}
            className="inline-flex items-center space-x-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            <Download size={18} />
            <span>CSV出力</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : summaryData.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p>該当月の勤怠データがありません</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">氏名</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">出勤日数</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">総労働時間</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">昼休憩なし</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {summaryData.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{row.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-700 text-right">{row.workDays}日</td>
                  <td className="px-6 py-4 text-sm text-gray-700 text-right">{row.totalHours.toFixed(1)}h</td>
                  <td className="px-6 py-4 text-sm text-gray-700 text-right">{row.noLunchDays}日</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50">
              <tr>
                <td className="px-6 py-3 text-sm font-medium text-gray-900">合計</td>
                <td className="px-6 py-3 text-sm font-medium text-gray-900 text-right">-</td>
                <td className="px-6 py-3 text-sm font-medium text-gray-900 text-right">
                  {summaryData.reduce((sum, r) => sum + r.totalHours, 0).toFixed(1)}h
                </td>
                <td className="px-6 py-3 text-sm font-medium text-gray-900 text-right">
                  {summaryData.reduce((sum, r) => sum + r.noLunchDays, 0)}日
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
