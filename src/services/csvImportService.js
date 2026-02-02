// src/services/csvImportService.js
import {
  doc,
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
  getDocs,
  collection,
} from 'firebase/firestore';
import { db } from './firebase';
import { buildNestedObject } from '../utils/csv/csvParser';

/**
 * CSVデータをFirestoreに一括書き込み
 * @param {object} params
 * @param {string} params.companyId - 企業ID
 * @param {Array} params.validRows - バリデーション済み行データ
 * @param {object} params.config - エンティティ設定
 * @param {function} params.onProgress - 進捗コールバック
 * @returns {Promise<ImportResult>}
 */
export async function importCsvToFirestore({
  companyId,
  validRows,
  config,
  onProgress,
}) {
  const results = {
    successCount: 0,
    failedRows: [],
    createdIds: [],
    updatedIds: [],
  };

  // Firestoreバッチは500件まで
  const BATCH_SIZE = 400; // 安全マージンを取って400件
  const batches = chunkArray(validRows, BATCH_SIZE);

  let processedCount = 0;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batchRows = batches[batchIndex];
    const batch = writeBatch(db);

    for (const row of batchRows) {
      try {
        // フラットなデータをネスト構造に変換
        const nestedData = buildNestedObject(row.originalData, config.fieldMappings);

        // 識別子フィールドを追加（新規作成時）
        if (config.identifierField && row.originalData[config.identifierColumn]) {
          nestedData[config.identifierField] = row.originalData[config.identifierColumn];
        }

        const collectionPath = config.collectionPath(companyId);

        if (row.isUpdate && row.existingId) {
          // 更新処理
          const docRef = doc(db, collectionPath, row.existingId);
          batch.update(docRef, {
            ...nestedData,
            updatedAt: serverTimestamp(),
          });
          results.updatedIds.push(row.existingId);
        } else {
          // 新規追加
          const newId = crypto.randomUUID();
          const docRef = doc(db, collectionPath, newId);
          batch.set(docRef, {
            ...nestedData,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          results.createdIds.push(newId);
        }
        results.successCount++;
      } catch (error) {
        results.failedRows.push({
          rowNumber: row.rowNumber,
          error: error.message,
          data: row.originalData,
        });
      }
    }

    try {
      await batch.commit();
    } catch (batchError) {
      // バッチ全体が失敗した場合、このバッチの全行をエラーとして記録
      console.error('Batch commit error:', batchError);
      for (const row of batchRows) {
        results.failedRows.push({
          rowNumber: row.rowNumber,
          error: batchError.message,
          data: row.originalData,
        });
      }
      results.successCount -= batchRows.length;
    }

    // 進捗報告
    processedCount += batchRows.length;
    onProgress?.({
      current: processedCount,
      total: validRows.length,
    });
  }

  return results;
}

/**
 * 識別子で既存データを検索
 * @param {string} companyId - 企業ID
 * @param {object} config - エンティティ設定
 * @returns {Promise<Map<string, string>>} 識別子 -> ドキュメントIDのマップ
 */
export async function fetchExistingIdentifiers(companyId, config) {
  if (!config.identifierField) {
    return new Map();
  }

  const collectionPath = config.collectionPath(companyId);
  const collectionRef = collection(db, collectionPath);
  const snapshot = await getDocs(collectionRef);

  const map = new Map();
  snapshot.docs.forEach(docSnap => {
    const identifier = docSnap.data()[config.identifierField];
    if (identifier) {
      map.set(identifier, docSnap.id);
    }
  });

  return map;
}

/**
 * 取引先データを取得（現場インポート時の参照解決用）
 * @param {string} companyId - 企業ID
 * @returns {Promise<Map<string, {id: string, clientName: string}>>}
 */
export async function fetchClientsMap(companyId) {
  const collectionRef = collection(db, `companies/${companyId}/clients`);
  const snapshot = await getDocs(collectionRef);

  const map = new Map();
  snapshot.docs.forEach(docSnap => {
    const data = docSnap.data();
    if (data.clientCode) {
      map.set(data.clientCode, {
        id: docSnap.id,
        clientName: data.clientName || '',
      });
    }
  });

  return map;
}

/**
 * 配列を指定サイズのチャンクに分割
 * @param {Array} array - 分割する配列
 * @param {number} size - チャンクサイズ
 * @returns {Array<Array>} チャンク配列
 */
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
