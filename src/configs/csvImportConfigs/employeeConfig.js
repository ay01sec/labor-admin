// src/configs/csvImportConfigs/employeeConfig.js

export const employeeConfig = {
  entityName: '社員',
  collectionPath: (companyId) => `companies/${companyId}/employees`,

  // 識別子フィールド（これで既存データとマッチング）
  identifierField: 'employeeCode',
  identifierColumn: '社員番号',

  // CSVカラムとFirestoreフィールドのマッピング
  fieldMappings: [
    // 基本情報
    { csvColumn: '社員番号', field: 'employeeCode', type: 'string', required: false },
    { csvColumn: '氏', field: 'lastName', type: 'string', required: true },
    { csvColumn: '名', field: 'firstName', type: 'string', required: true },
    { csvColumn: '氏（ひらがな）', field: 'lastNameKana', type: 'string', required: false },
    { csvColumn: '名（ひらがな）', field: 'firstNameKana', type: 'string', required: false },
    { csvColumn: '生年月日', field: 'birthDate', type: 'date', required: false },
    { csvColumn: '性別', field: 'gender', type: 'enum', options: ['男性', '女性'], required: false },
    { csvColumn: '血液型', field: 'bloodType', type: 'enum', options: ['A', 'B', 'O', 'AB'], required: false },

    // ネスト構造: address
    { csvColumn: '郵便番号', field: 'address.postalCode', type: 'string', required: false },
    { csvColumn: '都道府県', field: 'address.prefecture', type: 'string', required: false },
    { csvColumn: '市区町村', field: 'address.city', type: 'string', required: false },
    { csvColumn: '番地', field: 'address.address', type: 'string', required: false },
    { csvColumn: '建物名', field: 'address.building', type: 'string', required: false },

    // ネスト構造: contact
    { csvColumn: '携帯電話', field: 'contact.mobile', type: 'string', required: false },
    { csvColumn: 'その他電話', field: 'contact.other', type: 'string', required: false },
    { csvColumn: 'メールアドレス', field: 'contact.email', type: 'email', required: false },

    // ネスト構造: employment
    { csvColumn: '雇用形態', field: 'employment.type', type: 'enum', options: ['正社員', '契約社員', 'パート', 'アルバイト'], required: false },
    { csvColumn: '入社日', field: 'employment.hireDate', type: 'date', required: false },
    { csvColumn: '退職日', field: 'employment.resignationDate', type: 'date', required: false },
    { csvColumn: '経験年数開始年', field: 'employment.experienceStartYear', type: 'number', required: false },
    { csvColumn: '任務', field: 'employment.role', type: 'string', required: false },
    { csvColumn: '職長', field: 'employment.isForeman', type: 'boolean', required: false },

    // ネスト構造: salary
    { csvColumn: '基本給', field: 'salary.baseSalary', type: 'number', required: false },
    { csvColumn: '住宅手当', field: 'salary.housingAllowance', type: 'number', required: false },
    { csvColumn: '職長手当', field: 'salary.foremanAllowance', type: 'number', required: false },
    { csvColumn: '通勤手当', field: 'salary.commuteAllowance', type: 'number', required: false },
    { csvColumn: 'その他手当', field: 'salary.otherAllowance', type: 'number', required: false },

    // ネスト構造: insurance
    { csvColumn: '社会保険番号', field: 'insurance.socialInsuranceNumber', type: 'string', required: false },
    { csvColumn: '年金番号', field: 'insurance.pensionNumber', type: 'string', required: false },
    { csvColumn: '雇用保険番号', field: 'insurance.employmentInsuranceNumber', type: 'string', required: false },

    // ネスト構造: bankInfo
    { csvColumn: '銀行名', field: 'bankInfo.bankName', type: 'string', required: false },
    { csvColumn: '支店名', field: 'bankInfo.branchName', type: 'string', required: false },
    { csvColumn: '口座種別', field: 'bankInfo.accountType', type: 'enum', options: ['普通', '当座'], required: false },
    { csvColumn: '口座番号', field: 'bankInfo.accountNumber', type: 'string', required: false },
    { csvColumn: '口座名義', field: 'bankInfo.accountHolder', type: 'string', required: false },

    // 配列フィールド（カンマ区切りで入力）
    { csvColumn: '資格', field: 'qualifications', type: 'array', required: false },
    { csvColumn: '免許', field: 'licenses', type: 'array', required: false },

    // ステータス
    { csvColumn: '在籍状況', field: 'isActive', type: 'boolean', required: false },
  ],

  // テンプレートのサンプルデータ
  sampleData: {
    '社員番号': 'EMP001',
    '氏': '山田',
    '名': '太郎',
    '氏（ひらがな）': 'やまだ',
    '名（ひらがな）': 'たろう',
    '生年月日': '1990-01-15',
    '性別': '男性',
    '血液型': 'A',
    '郵便番号': '123-4567',
    '都道府県': '東京都',
    '市区町村': '渋谷区',
    '番地': '1-2-3',
    '建物名': 'サンプルビル101',
    '携帯電話': '090-1234-5678',
    'その他電話': '',
    'メールアドレス': 'yamada@example.com',
    '雇用形態': '正社員',
    '入社日': '2020-04-01',
    '退職日': '',
    '経験年数開始年': '2015',
    '任務': '現場作業員',
    '職長': 'false',
    '基本給': '250000',
    '住宅手当': '20000',
    '職長手当': '',
    '通勤手当': '15000',
    'その他手当': '',
    '社会保険番号': '',
    '年金番号': '',
    '雇用保険番号': '',
    '銀行名': 'サンプル銀行',
    '支店名': '渋谷支店',
    '口座種別': '普通',
    '口座番号': '1234567',
    '口座名義': 'ヤマダ タロウ',
    '資格': '足場組立,玉掛け',
    '免許': '普通自動車,フォークリフト',
    '在籍状況': 'true',
  },
};
