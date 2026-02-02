// src/utils/csv/csvValidator.js

/**
 * パース済みデータをバリデーション
 * @param {Array} parsedRows - パース済み行データ
 * @param {object} config - エンティティ設定
 * @param {Map<string, string>} existingIdentifiers - 既存データの識別子マップ
 * @returns {ValidationResult}
 */
export function validateCsvData(parsedRows, config, existingIdentifiers) {
  const validRows = [];
  const errorRows = [];
  let newCount = 0;
  let updateCount = 0;

  for (const row of parsedRows) {
    const errors = validateRow(row.data, config);

    // 新規/更新の判定
    const identifierValue = row.data[config.identifierColumn];
    let isUpdate = false;
    let existingId = null;

    if (identifierValue && identifierValue.trim() !== '') {
      existingId = existingIdentifiers.get(identifierValue);
      if (existingId) {
        isUpdate = true;
      }
    }

    if (errors.length > 0) {
      errorRows.push({
        rowNumber: row.rowNumber,
        originalData: row.data,
        errors,
        isUpdate,
        existingId,
      });
    } else {
      validRows.push({
        rowNumber: row.rowNumber,
        originalData: row.data,
        data: row.data,
        isUpdate,
        existingId,
      });

      if (isUpdate) {
        updateCount++;
      } else {
        newCount++;
      }
    }
  }

  return {
    validRows,
    errorRows,
    newCount,
    updateCount,
    errorCount: errorRows.length,
    totalCount: parsedRows.length,
  };
}

/**
 * 1行のデータをバリデーション
 * @param {object} rowData - 行データ
 * @param {object} config - エンティティ設定
 * @returns {Array<string>} エラーメッセージの配列
 */
function validateRow(rowData, config) {
  const errors = [];

  for (const mapping of config.fieldMappings) {
    const value = rowData[mapping.csvColumn];
    const fieldErrors = validateField(value, mapping);
    errors.push(...fieldErrors);
  }

  return errors;
}

/**
 * 個別フィールドのバリデーション
 * @param {string} value - 値
 * @param {object} mapping - フィールドマッピング
 * @returns {Array<string>} エラーメッセージの配列
 */
function validateField(value, mapping) {
  const errors = [];
  const isEmpty = value === undefined || value === null || value.toString().trim() === '';

  // 必須チェック
  if (mapping.required && isEmpty) {
    errors.push(`${mapping.csvColumn}は必須です`);
    return errors;
  }

  // 空の場合はこれ以上チェックしない
  if (isEmpty) {
    return errors;
  }

  // 型別バリデーション
  switch (mapping.type) {
    case 'number':
      if (!/^-?\d+(\.\d+)?$/.test(value.toString().trim())) {
        errors.push(`${mapping.csvColumn}は数値で入力してください`);
      }
      break;

    case 'date':
      if (!isValidDate(value)) {
        errors.push(`${mapping.csvColumn}は日付形式(YYYY-MM-DD)で入力してください`);
      }
      break;

    case 'email':
      if (!isValidEmail(value)) {
        errors.push(`${mapping.csvColumn}は正しいメールアドレス形式で入力してください`);
      }
      break;

    case 'boolean':
      const boolValues = ['true', 'false', '1', '0', 'はい', 'いいえ'];
      if (!boolValues.includes(value.toString().toLowerCase())) {
        errors.push(`${mapping.csvColumn}はtrue/false/1/0/はい/いいえで入力してください`);
      }
      break;

    case 'enum':
      if (mapping.options && !mapping.options.includes(value)) {
        errors.push(`${mapping.csvColumn}は次のいずれかで入力してください: ${mapping.options.join(', ')}`);
      }
      break;

    case 'array':
      // 配列は特にバリデーションなし（カンマ区切りで分割される）
      break;

    case 'string':
    default:
      // 文字列は特にバリデーションなし
      break;
  }

  return errors;
}

/**
 * 日付形式のバリデーション
 * @param {string} value - 値
 * @returns {boolean}
 */
function isValidDate(value) {
  // YYYY-MM-DD, YYYY/MM/DD形式をサポート
  const patterns = [
    /^\d{4}-\d{2}-\d{2}$/,
    /^\d{4}\/\d{2}\/\d{2}$/,
  ];

  if (!patterns.some(p => p.test(value))) {
    return false;
  }

  const date = new Date(value.replace(/\//g, '-'));
  return !isNaN(date.getTime());
}

/**
 * メールアドレス形式のバリデーション
 * @param {string} value - 値
 * @returns {boolean}
 */
function isValidEmail(value) {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(value);
}

/**
 * バリデーション結果のサマリーを取得
 * @param {object} validationResult - バリデーション結果
 * @returns {object} サマリー情報
 */
export function getValidationSummary(validationResult) {
  return {
    totalCount: validationResult.totalCount,
    newCount: validationResult.newCount,
    updateCount: validationResult.updateCount,
    errorCount: validationResult.errorCount,
    validCount: validationResult.validRows.length,
    hasErrors: validationResult.errorCount > 0,
    canProceed: validationResult.validRows.length > 0,
  };
}
