import { Link } from 'react-router-dom';
import { FileText, AlertCircle } from 'lucide-react';

export default function NotificationPopup({ notifications, onClose }) {
  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-lg border border-gray-200 z-50 max-h-96 overflow-y-auto">
      <div className="p-3 border-b border-gray-100">
        <h3 className="font-medium text-gray-900 text-sm">通知</h3>
      </div>

      {notifications.length === 0 ? (
        <div className="p-4 text-center text-gray-500 text-sm">
          通知はありません
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {notifications.slice(0, 20).map((item) => (
            <li key={item.id}>
              <Link
                to={`/reports/${item.id}`}
                onClick={onClose}
                className="flex items-start gap-3 p-3 hover:bg-gray-50 transition-colors"
              >
                {item.type === 'submitted' ? (
                  <FileText size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
                ) : (
                  <AlertCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 truncate">
                    {item.type === 'submitted'
                      ? `${item.createdByName}さんが日報を提出`
                      : `${item.siteName}の日報が差戻し`
                    }
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {item.siteName} - {formatDate(item.updatedAt)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="p-2 border-t border-gray-100">
        <Link
          to="/reports"
          onClick={onClose}
          className="block text-center text-sm text-blue-600 hover:text-blue-800 py-1"
        >
          すべての日報を見る
        </Link>
      </div>
    </div>
  );
}
