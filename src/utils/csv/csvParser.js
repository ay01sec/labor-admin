// src/utils/csv/csvParser.js
import Encoding from 'encoding-japanese';

/**
 * 文字コードを自動判定してデコード
 * @param {ArrayBuffer} buffer - ファイルバッファ
 * @returns {string} デコードされたテキスト
 */
export function detectAndDecode(buffer) {
  const uint8Array = new Uint8Array(buffer);

  // BOM付きUTF-8をチェック
  if (uint8Array[0] === 0xEF && uint8Array[1] === 0xBB && uint8Array[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(buffer);
  }

  // 文字コードを自動判定
  const detected = Encoding.detect(uint8Array);

  if (detected === 'SJIS' || detected === 'EUCJP') {
    // Shift-JIS/EUC-JPをUnicodeに変換
    const unicodeArray = Encoding.convert(uint8Array, {
      to: 'UNICODE',
      from: detected,
    });
    return Encoding.codeToString(unicodeArray);
  }

  // デフォルトはUTF-8
  return new TextDecoder('utf-8').decode(buffer);
}

/**
 * CSVテキストをパースして行オブジェクトの配列を返す
 * @param {string} csvText - CSVテキスト
 * @returns {Array<{rowNumber: number, data: object, originalLine: string}>}
 */
export function parseCsv(csvText) {
  // 改行コードの正規化
  const normalizedText = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const lines = parseLines(normalizedText);

  if (lines.length < 2) {
    throw new Error('CSVファイルにはヘッダー行と少なくとも1行のデータが必要です');
  }

  const headers = lines[0];
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i];

    // 空行をスキップ
    if (values.length === 1 && values[0] === '') {
      continue;
    }

    const data = {};
    headers.forEach((header, index) => {
      data[header] = values[index] || '';
    });

    rows.push({
      rowNumber: i + 1, // 1始まり（ヘッダーが1行目）
      data,
      originalLine: values.join(','),
    });
  }

  return rows;
}

/**
 * CSV行をパース（クォート対応）
 * @param {string} text - CSVテキスト
 * @returns {Array<Array<string>>} 2次元配列
 */
function parseLines(text) {
  const lines = [];
  let currentLine = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // エスケープされたダブルクォート
          currentField += '"';
          i++;
        } else {
          // クォート終了
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentLine.push(currentField.trim());
        currentField = '';
      } else if (char === '\n') {
        currentLine.push(currentField.trim());
        lines.push(currentLine);
        currentLine = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
  }

  // 最後のフィールドと行を追加
  if (currentField !== '' || currentLine.length > 0) {
    currentLine.push(currentField.trim());
    lines.push(currentLine);
  }

  return lines;
}

/**
 * ネスト構造のオブジェクトを生成
 * @param {object} flatData - CSVからパースしたフラットなデータ
 * @param {Array} fieldMappings - フィールドマッピング設定
 * @returns {object} ネスト構造のオブジェクト
 */
export function buildNestedObject(flatData, fieldMappings) {
  const result = {};

  for (const mapping of fieldMappings) {
    const csvValue = flatData[mapping.csvColumn];

    if (csvValue === undefined || csvValue === '') {
      continue;
    }

    // 値を適切な型に変換
    const convertedValue = convertValue(csvValue, mapping);

    // ネストしたパスを処理（例: 'address.postalCode'）
    setNestedValue(result, mapping.field, convertedValue);
  }

  return result;
}

/**
 * 値を指定された型に変換
 * @param {string} value - 文字列値
 * @param {object} mapping - フィールドマッピング
 * @returns {any} 変換された値
 */
function convertValue(value, mapping) {
  switch (mapping.type) {
    case 'number':
      const num = parseInt(value, 10);
      return isNaN(num) ? 0 : num;

    case 'boolean':
      return value.toLowerCase() === 'true' || value === '1' || value === 'はい';

    case 'date':
      // YYYY-MM-DD形式を想定
      if (!value) return null;
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date;

    case 'array':
      // カンマ区切りで配列に変換
      return value.split(/[,、]/).map(v => v.trim()).filter(v => v !== '');

    case 'enum':
      // そのまま返す（バリデーターでチェック）
      return value;

    default:
      return value;
  }
}

/**
 * ネストしたオブジェクトに値をセット
 * @param {object} obj - 対象オブジェクト
 * @param {string} path - ドット区切りのパス（例: 'address.postalCode'）
 * @param {any} value - セットする値
 */
function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part]) {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * CSVテンプレートを生成してダウンロード
 * @param {object} config - エンティティ設定
 */
export function downloadCsvTemplate(config) {
  // ヘッダー行を生成
  const headers = config.fieldMappings.map(m => m.csvColumn);

  // サンプルデータ行を生成
  const sampleValues = config.fieldMappings.map(m =>
    config.sampleData[m.csvColumn] || ''
  );

  // CSV文字列を生成
  const csvContent = [
    headers.join(','),
    sampleValues.map(v => `"${v}"`).join(','),
  ].join('\n');

  // BOM付きUTF-8でエンコード
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8' });

  // ダウンロード実行
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${config.entityName}インポートテンプレート.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * エラー行をCSVとしてダウンロード
 * @param {Array} errorRows - エラー行の配列
 * @param {object} config - エンティティ設定
 */
export function downloadErrorRowsCsv(errorRows, config) {
  // ヘッダー行を生成（エラー内容カラムを追加）
  const headers = [...config.fieldMappings.map(m => m.csvColumn), 'エラー内容'];

  // エラー行のデータを生成
  const rows = errorRows.map(row => {
    const values = config.fieldMappings.map(m =>
      row.originalData[m.csvColumn] || ''
    );
    values.push(row.errors.join('; '));
    return values.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });

  // CSV文字列を生成
  const csvContent = [headers.join(','), ...rows].join('\n');

  // BOM付きUTF-8でエンコード
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8' });

  // ダウンロード実行
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${config.entityName}インポートエラー.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
