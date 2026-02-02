// src/components/CsvImport/CsvImportModal.jsx
import { useEffect } from 'react';
import { X, CheckCircle, AlertTriangle, Download } from 'lucide-react';
import { useCsvImport } from '../../hooks/useCsvImport';
import { employeeConfig, clientConfig, siteConfig } from '../../configs/csvImportConfigs';
import { downloadErrorRowsCsv } from '../../utils/csv/csvParser';
import CsvFileUploader from './CsvFileUploader';
import CsvPreviewTable from './CsvPreviewTable';
import CsvImportProgress from './CsvImportProgress';

// エンティティタイプから設定を取得
const configs = {
  employee: employeeConfig,
  client: clientConfig,
  site: siteConfig,
};

export default function CsvImportModal({
  isOpen,
  onClose,
  entityType,
  companyId,
  onComplete,
}) {
  const config = configs[entityType];

  const {
    step,
    file,
    validationResult,
    importProgress,
    importResult,
    error,
    isLoading,
    handleFileSelect,
    executeImport,
    cancelImport,
    reset,
  } = useCsvImport(config, companyId);

  // モーダルが閉じられた時にリセット
  useEffect(() => {
    if (!isOpen) {
      reset();
    }
  }, [isOpen, reset]);

  // 完了時のコールバック
  useEffect(() => {
    if (step === 'complete' && importResult) {
      onComplete?.(importResult);
    }
  }, [step, importResult, onComplete]);

  if (!isOpen) return null;

  // サマリー情報
  const summary = validationResult ? {
    total: validationResult.totalCount,
    newCount: validationResult.newCount,
    updateCount: validationResult.updateCount,
    errorCount: validationResult.errorCount,
  } : null;

  // エラー行のダウンロード
  const handleDownloadErrors = () => {
    if (importResult?.errorRows) {
      downloadErrorRowsCsv(importResult.errorRows, config);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* オーバーレイ */}
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={step !== 'importing' ? onClose : undefined} />

      {/* モーダル */}
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
          {/* ヘッダー */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-800">
              {config.entityName}データ CSVインポート
            </h2>
            {step !== 'importing' && (
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={20} className="text-gray-500" />
              </button>
            )}
          </div>

          {/* コンテンツ */}
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
            {/* Step 1: アップロード */}
            {step === 'upload' && (
              <CsvFileUploader
                config={config}
                onFileSelect={handleFileSelect}
                isLoading={isLoading}
                error={error}
              />
            )}

            {/* Step 2: プレビュー */}
            {step === 'preview' && validationResult && (
              <div className="space-y-6">
                {/* サマリー */}
                <div className="grid grid-cols-4 gap-4">
                  <div className="bg-gray-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-gray-900">{summary.total}</p>
                    <p className="text-sm text-gray-500">総行数</p>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-green-600">{summary.newCount}</p>
                    <p className="text-sm text-gray-500">新規追加</p>
                  </div>
                  <div className="bg-yellow-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-yellow-600">{summary.updateCount}</p>
                    <p className="text-sm text-gray-500">更新</p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-red-600">{summary.errorCount}</p>
                    <p className="text-sm text-gray-500">エラー</p>
                  </div>
                </div>

                {/* エラー警告 */}
                {summary.errorCount > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start space-x-3">
                    <AlertTriangle className="text-amber-500 flex-shrink-0 mt-0.5" size={20} />
                    <div>
                      <p className="font-medium text-amber-800">
                        {summary.errorCount}件のエラーがあります
                      </p>
                      <p className="text-sm text-amber-700 mt-1">
                        エラー行をスキップしてインポートするか、中止してデータを修正してください。
                      </p>
                    </div>
                  </div>
                )}

                {/* プレビューテーブル */}
                <CsvPreviewTable
                  validationResult={validationResult}
                  config={config}
                />
              </div>
            )}

            {/* Step 3: インポート中 */}
            {step === 'importing' && (
              <CsvImportProgress progress={importProgress} />
            )}

            {/* Step 4: 完了 */}
            {step === 'complete' && importResult && (
              <div className="py-8 space-y-6">
                {/* 成功アイコン */}
                <div className="flex justify-center">
                  <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                    <CheckCircle className="w-12 h-12 text-green-600" />
                  </div>
                </div>

                {/* テキスト */}
                <div className="text-center">
                  <h3 className="text-xl font-bold text-gray-900">インポート完了</h3>
                  <p className="text-gray-500 mt-1">
                    {config.entityName}データのインポートが完了しました
                  </p>
                </div>

                {/* 結果サマリー */}
                <div className="max-w-md mx-auto bg-gray-50 rounded-lg p-6 space-y-3">
                  <div className="flex justify-between">
                    <span className="text-gray-600">新規追加</span>
                    <span className="font-medium text-green-600">{importResult.createdIds.length}件</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">更新</span>
                    <span className="font-medium text-yellow-600">{importResult.updatedIds.length}件</span>
                  </div>
                  {importResult.skippedCount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">スキップ（エラー）</span>
                      <span className="font-medium text-red-600">{importResult.skippedCount}件</span>
                    </div>
                  )}
                  <hr className="border-gray-200" />
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-700">合計処理</span>
                    <span className="font-bold text-gray-900">{importResult.successCount}件</span>
                  </div>
                </div>

                {/* エラー行ダウンロード */}
                {importResult.errorRows?.length > 0 && (
                  <div className="flex justify-center">
                    <button
                      onClick={handleDownloadErrors}
                      className="inline-flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <Download size={16} />
                      <span>エラー行をダウンロード</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* エラー状態 */}
            {step === 'error' && (
              <div className="py-8 text-center">
                <div className="flex justify-center mb-4">
                  <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center">
                    <AlertTriangle className="w-12 h-12 text-red-600" />
                  </div>
                </div>
                <h3 className="text-xl font-bold text-gray-900">エラーが発生しました</h3>
                <p className="text-red-600 mt-2">{error}</p>
              </div>
            )}
          </div>

          {/* フッター */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end space-x-3">
            {step === 'upload' && (
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                キャンセル
              </button>
            )}

            {step === 'preview' && (
              <>
                <button
                  onClick={cancelImport}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  中止
                </button>
                {summary && summary.newCount + summary.updateCount > 0 && (
                  <button
                    onClick={() => executeImport(true)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    {summary.errorCount > 0
                      ? 'エラー行をスキップしてインポート'
                      : 'インポート実行'}
                  </button>
                )}
              </>
            )}

            {(step === 'complete' || step === 'error') && (
              <button
                onClick={onClose}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                閉じる
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
