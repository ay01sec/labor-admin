// src/components/CsvImport/CsvFileUploader.jsx
import { useState, useCallback, useRef } from 'react';
import { Upload, FileText, Download, AlertCircle } from 'lucide-react';
import { downloadCsvTemplate } from '../../utils/csv/csvParser';

export default function CsvFileUploader({ config, onFileSelect, isLoading, error }) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files[0];
    if (file) {
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleDownloadTemplate = useCallback(() => {
    downloadCsvTemplate(config);
  }, [config]);

  return (
    <div className="space-y-6">
      {/* エラー表示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-start space-x-3">
          <AlertCircle className="flex-shrink-0 mt-0.5" size={18} />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* ドラッグ&ドロップエリア */}
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-xl p-12 text-center cursor-pointer
          transition-all duration-200
          ${isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
          }
          ${isLoading ? 'opacity-50 pointer-events-none' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className="hidden"
        />

        {isLoading ? (
          <div className="flex flex-col items-center space-y-4">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-600">ファイルを処理中...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-4">
            <div className={`
              w-16 h-16 rounded-full flex items-center justify-center
              ${isDragging ? 'bg-blue-100' : 'bg-gray-100'}
            `}>
              {isDragging ? (
                <FileText className="text-blue-500" size={32} />
              ) : (
                <Upload className="text-gray-400" size={32} />
              )}
            </div>
            <div>
              <p className="text-lg font-medium text-gray-700">
                CSVファイルをドラッグ&ドロップ
              </p>
              <p className="text-sm text-gray-500 mt-1">
                またはクリックしてファイルを選択
              </p>
            </div>
          </div>
        )}
      </div>

      {/* テンプレートダウンロード */}
      <div className="flex items-center justify-between bg-gray-50 rounded-lg p-4">
        <div>
          <p className="text-sm font-medium text-gray-700">テンプレートファイル</p>
          <p className="text-xs text-gray-500 mt-1">
            インポート用のCSVテンプレートをダウンロードできます
          </p>
        </div>
        <button
          onClick={handleDownloadTemplate}
          className="inline-flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <Download size={16} />
          <span>テンプレートをダウンロード</span>
        </button>
      </div>

      {/* 注意事項 */}
      <div className="text-sm text-gray-500 space-y-1">
        <p>* 対応文字コード: UTF-8, Shift-JIS</p>
        <p>* ファイル形式: CSV（カンマ区切り）</p>
        <p>* 1行目はヘッダー行として認識されます</p>
      </div>
    </div>
  );
}
