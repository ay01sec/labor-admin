// src/configs/csvImportConfigs/index.js
export { employeeConfig } from './employeeConfig';
export { clientConfig } from './clientConfig';
export { siteConfig } from './siteConfig';

// エンティティタイプから設定を取得するヘルパー
export function getConfigByType(entityType) {
  const configs = {
    employee: require('./employeeConfig').employeeConfig,
    client: require('./clientConfig').clientConfig,
    site: require('./siteConfig').siteConfig,
  };

  return configs[entityType] || null;
}
