// src/components/CsvImport/CsvImportProgress.jsx
import { Loader2 } from 'lucide-react';

export default function CsvImportProgress({ progress }) {
  const percentage = progress?.total
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div className="py-8 space-y-6">
      {/* アニメーションアイコン */}
      <div className="flex justify-center">
        <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center">
          <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
        </div>
      </div>

      {/* テキスト */}
      <div className="text-center">
        <h3 className="text-lg font-medium text-gray-900">インポート中...</h3>
        <p className="text-sm text-gray-500 mt-1">
          しばらくお待ちください
        </p>
      </div>

      {/* プログレスバー */}
      <div className="max-w-md mx-auto space-y-2">
        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div className="flex justify-between text-sm text-gray-600">
          <span>{progress?.current || 0} / {progress?.total || 0} 件</span>
          <span>{percentage}%</span>
        </div>
      </div>
    </div>
  );
}
