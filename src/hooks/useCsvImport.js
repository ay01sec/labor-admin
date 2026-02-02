// src/hooks/useCsvImport.js
import { useState, useCallback } from 'react';
import { parseCsv, detectAndDecode, buildNestedObject } from '../utils/csv/csvParser';
import { validateCsvData } from '../utils/csv/csvValidator';
import { importCsvToFirestore, fetchExistingIdentifiers, fetchClientsMap } from '../services/csvImportService';

/**
 * CSVインポート処理用カスタムフック
 * @param {object} config - エンティティ設定
 * @param {string} companyId - 企業ID
 * @returns {object} 状態と操作関数
 */
export function useCsvImport(config, companyId) {
  const [state, setState] = useState({
    step: 'upload', // 'upload' | 'preview' | 'importing' | 'complete' | 'error'
    file: null,
    parsedData: [],
    validationResult: null,
    importProgress: null,
    importResult: null,
    error: null,
    isLoading: false,
  });

  // ファイル選択処理
  const handleFileSelect = useCallback(async (file) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // ファイルを読み込み
      const buffer = await file.arrayBuffer();
      const text = detectAndDecode(buffer);
      const parsedRows = parseCsv(text);

      // 既存データ取得（識別子マッチング用）
      const existingMap = await fetchExistingIdentifiers(companyId, config);

      // 現場の場合は取引先マップも取得
      let clientsMap = new Map();
      if (config.resolveClientReference) {
        clientsMap = await fetchClientsMap(companyId);
      }

      // バリデーション実行
      const result = validateCsvData(parsedRows, config, existingMap);

      // 現場の場合、取引先コードから取引先ID・名を解決
      if (config.resolveClientReference) {
        for (const row of result.validRows) {
          const clientCode = row.originalData['取引先コード'];
          if (clientCode && clientsMap.has(clientCode)) {
            const client = clientsMap.get(clientCode);
            row.originalData['_clientId'] = client.id;
            if (!row.originalData['取引先名']) {
              row.originalData['取引先名'] = client.clientName;
            }
          }
        }
      }

      setState(prev => ({
        ...prev,
        file,
        parsedData: parsedRows,
        validationResult: result,
        step: 'preview',
        isLoading: false,
      }));
    } catch (error) {
      console.error('CSV読み込みエラー:', error);
      setState(prev => ({
        ...prev,
        error: error.message || 'CSVファイルの読み込みに失敗しました',
        isLoading: false,
      }));
    }
  }, [config, companyId]);

  // インポート実行
  const executeImport = useCallback(async (skipErrors = true) => {
    if (!state.validationResult) return;

    const rowsToImport = skipErrors
      ? state.validationResult.validRows
      : state.validationResult.validRows;

    if (rowsToImport.length === 0) {
      setState(prev => ({
        ...prev,
        error: 'インポートするデータがありません',
      }));
      return;
    }

    setState(prev => ({
      ...prev,
      step: 'importing',
      importProgress: { current: 0, total: rowsToImport.length },
    }));

    try {
      const result = await importCsvToFirestore({
        companyId,
        validRows: rowsToImport,
        config,
        onProgress: (progress) => {
          setState(prev => ({ ...prev, importProgress: progress }));
        },
      });

      setState(prev => ({
        ...prev,
        step: 'complete',
        importResult: {
          ...result,
          skippedCount: state.validationResult.errorCount,
          errorRows: state.validationResult.errorRows,
        },
      }));

      return result;
    } catch (error) {
      console.error('インポートエラー:', error);
      setState(prev => ({
        ...prev,
        step: 'error',
        error: error.message || 'インポート処理に失敗しました',
      }));
    }
  }, [state.validationResult, companyId, config]);

  // 中止処理
  const cancelImport = useCallback(() => {
    setState(prev => ({
      ...prev,
      step: 'upload',
      file: null,
      parsedData: [],
      validationResult: null,
      importProgress: null,
      importResult: null,
      error: null,
    }));
  }, []);

  // リセット
  const reset = useCallback(() => {
    setState({
      step: 'upload',
      file: null,
      parsedData: [],
      validationResult: null,
      importProgress: null,
      importResult: null,
      error: null,
      isLoading: false,
    });
  }, []);

  return {
    ...state,
    handleFileSelect,
    executeImport,
    cancelImport,
    reset,
  };
}
