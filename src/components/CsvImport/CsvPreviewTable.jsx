// src/components/CsvImport/CsvPreviewTable.jsx
import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';

const ITEMS_PER_PAGE = 10;

export default function CsvPreviewTable({ validationResult, config }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [showOnlyErrors, setShowOnlyErrors] = useState(false);

  // 表示するカラム（最初の5つ + ステータス）
  const displayColumns = useMemo(() => {
    return config.fieldMappings.slice(0, 5).map(m => m.csvColumn);
  }, [config]);

  // 表示するデータ
  const displayData = useMemo(() => {
    const allRows = [
      ...validationResult.validRows.map(row => ({ ...row, status: row.isUpdate ? 'update' : 'new' })),
      ...validationResult.errorRows.map(row => ({ ...row, status: 'error' })),
    ].sort((a, b) => a.rowNumber - b.rowNumber);

    if (showOnlyErrors) {
      return allRows.filter(row => row.status === 'error');
    }
    return allRows;
  }, [validationResult, showOnlyErrors]);

  // ページネーション
  const totalPages = Math.ceil(displayData.length / ITEMS_PER_PAGE);
  const paginatedData = displayData.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // ステータスバッジ
  const StatusBadge = ({ status }) => {
    switch (status) {
      case 'new':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
            <CheckCircle size={12} />
            <span>新規</span>
          </span>
        );
      case 'update':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
            <RefreshCw size={12} />
            <span>更新</span>
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
            <AlertCircle size={12} />
            <span>エラー</span>
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      {/* フィルター */}
      {validationResult.errorCount > 0 && (
        <div className="flex items-center space-x-2">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showOnlyErrors}
              onChange={(e) => {
                setShowOnlyErrors(e.target.checked);
                setCurrentPage(1);
              }}
              className="rounded border-gray-300 text-red-600 focus:ring-red-500"
            />
            <span className="text-sm text-gray-700">エラー行のみ表示</span>
          </label>
        </div>
      )}

      {/* テーブル */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                行
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                状態
              </th>
              {displayColumns.map(col => (
                <th key={col} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {col}
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                備考
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {paginatedData.map((row) => (
              <tr
                key={row.rowNumber}
                className={`
                  ${row.status === 'error' ? 'bg-red-50' : ''}
                  ${row.status === 'update' ? 'bg-yellow-50' : ''}
                  ${row.status === 'new' ? 'bg-green-50' : ''}
                `}
              >
                <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                  {row.rowNumber}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <StatusBadge status={row.status} />
                </td>
                {displayColumns.map(col => (
                  <td key={col} className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap max-w-xs truncate">
                    {row.originalData[col] || '-'}
                  </td>
                ))}
                <td className="px-4 py-3 text-sm whitespace-nowrap">
                  {row.status === 'error' && row.errors && (
                    <span className="text-red-600 text-xs">
                      {row.errors.join(', ')}
                    </span>
                  )}
                  {row.status === 'update' && (
                    <span className="text-yellow-600 text-xs">既存データを上書き</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ページネーション */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {displayData.length}件中 {(currentPage - 1) * ITEMS_PER_PAGE + 1} - {Math.min(currentPage * ITEMS_PER_PAGE, displayData.length)}件を表示
          </p>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm text-gray-700">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
