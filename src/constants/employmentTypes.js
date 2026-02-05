// デフォルトの雇用形態
export const DEFAULT_EMPLOYMENT_TYPES = [
  { id: 'seishain', label: '正社員', color: 'blue', isDefault: true },
  { id: 'keiyaku', label: '契約社員', color: 'purple', isDefault: true },
  { id: 'part', label: 'パート', color: 'orange', isDefault: true },
  { id: 'arbeit', label: 'アルバイト', color: 'yellow', isDefault: true },
  { id: 'gaibu', label: '外部', color: 'gray', isDefault: true }
];

// 利用可能な色とそのスタイル
export const EMPLOYMENT_TYPE_COLORS = {
  blue: { bg: 'bg-blue-100', text: 'text-blue-800', label: '青' },
  purple: { bg: 'bg-purple-100', text: 'text-purple-800', label: '紫' },
  orange: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'オレンジ' },
  yellow: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: '黄' },
  gray: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'グレー' },
  green: { bg: 'bg-green-100', text: 'text-green-800', label: '緑' },
  red: { bg: 'bg-red-100', text: 'text-red-800', label: '赤' },
  pink: { bg: 'bg-pink-100', text: 'text-pink-800', label: 'ピンク' },
  indigo: { bg: 'bg-indigo-100', text: 'text-indigo-800', label: '藍' },
  teal: { bg: 'bg-teal-100', text: 'text-teal-800', label: 'ティール' }
};

// ラベルから雇用形態を検索するヘルパー
export function findEmploymentTypeByLabel(types, label) {
  return types.find(t => t.label === label);
}

// 雇用形態の色スタイルを取得
export function getEmploymentTypeStyle(types, label) {
  const type = findEmploymentTypeByLabel(types, label);
  if (type && EMPLOYMENT_TYPE_COLORS[type.color]) {
    return EMPLOYMENT_TYPE_COLORS[type.color];
  }
  // 見つからない場合はグレーを返す
  return EMPLOYMENT_TYPE_COLORS.gray;
}
