// src/configs/csvImportConfigs/clientConfig.js

export const clientConfig = {
  entityName: '取引先',
  collectionPath: (companyId) => `companies/${companyId}/clients`,

  // 識別子フィールド（これで既存データとマッチング）
  identifierField: 'clientCode',
  identifierColumn: '取引先コード',

  // CSVカラムとFirestoreフィールドのマッピング
  fieldMappings: [
    { csvColumn: '取引先コード', field: 'clientCode', type: 'string', required: false },
    { csvColumn: '取引先名', field: 'clientName', type: 'string', required: true },
    { csvColumn: '郵便番号', field: 'postalCode', type: 'string', required: false },
    { csvColumn: '都道府県', field: 'prefecture', type: 'string', required: false },
    { csvColumn: '市区町村', field: 'city', type: 'string', required: false },
    { csvColumn: '番地', field: 'address', type: 'string', required: false },
    { csvColumn: '建物名', field: 'building', type: 'string', required: false },
    { csvColumn: '電話番号', field: 'tel', type: 'string', required: false },
    { csvColumn: 'FAX', field: 'fax', type: 'string', required: false },
    { csvColumn: 'メールアドレス', field: 'email', type: 'email', required: false },
    { csvColumn: '担当者名', field: 'managerName', type: 'string', required: false },
  ],

  // テンプレートのサンプルデータ
  sampleData: {
    '取引先コード': 'CLT001',
    '取引先名': '株式会社サンプル建設',
    '郵便番号': '100-0001',
    '都道府県': '東京都',
    '市区町村': '千代田区',
    '番地': '1-1-1',
    '建物名': 'サンプルタワー10F',
    '電話番号': '03-1234-5678',
    'FAX': '03-1234-5679',
    'メールアドレス': 'info@sample.co.jp',
    '担当者名': '佐藤 次郎',
  },
};
