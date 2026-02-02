// src/configs/csvImportConfigs/siteConfig.js

export const siteConfig = {
  entityName: '現場',
  collectionPath: (companyId) => `companies/${companyId}/sites`,

  // 識別子フィールド（これで既存データとマッチング）
  identifierField: 'siteCode',
  identifierColumn: '現場コード',

  // CSVカラムとFirestoreフィールドのマッピング
  fieldMappings: [
    { csvColumn: '現場コード', field: 'siteCode', type: 'string', required: false },
    { csvColumn: '現場名', field: 'siteName', type: 'string', required: true },
    { csvColumn: '取引先コード', field: 'clientCode', type: 'string', required: false },
    { csvColumn: '取引先名', field: 'clientName', type: 'string', required: false },
    { csvColumn: '住所', field: 'address', type: 'string', required: false },
    { csvColumn: '開始日', field: 'startDate', type: 'date', required: false },
    { csvColumn: '終了日', field: 'endDate', type: 'date', required: false },
    { csvColumn: 'ステータス', field: 'status', type: 'enum', options: ['pending', 'active', 'completed'], required: false },
  ],

  // テンプレートのサンプルデータ
  sampleData: {
    '現場コード': 'SITE001',
    '現場名': 'サンプルビル新築工事',
    '取引先コード': 'CLT001',
    '取引先名': '株式会社サンプル建設',
    '住所': '東京都新宿区西新宿2-8-1',
    '開始日': '2025-01-15',
    '終了日': '2025-06-30',
    'ステータス': 'active',
  },

  // 取引先コードから取引先IDと取引先名を解決するフラグ
  resolveClientReference: true,
};
