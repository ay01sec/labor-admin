import { Page, Locator } from '@playwright/test';

export class EmployeeListPage {
  readonly page: Page;
  readonly pageTitle: Locator;
  readonly searchInput: Locator;
  readonly employmentTypeFilter: Locator;
  readonly statusFilter: Locator;
  readonly newEmployeeButton: Locator;
  readonly csvImportButton: Locator;
  readonly csvExportButton: Locator;
  readonly employeeTable: Locator;
  readonly prevPageButton: Locator;
  readonly nextPageButton: Locator;
  readonly pageInfo: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pageTitle = page.locator('h1', { hasText: '社員管理' });
    this.searchInput = page.locator('input[placeholder="氏名で検索..."]');
    this.employmentTypeFilter = page.locator('select').first();
    this.statusFilter = page.locator('select').nth(1);
    this.newEmployeeButton = page.locator('a', { hasText: '新規登録' });
    this.csvImportButton = page.locator('button', { hasText: 'CSVインポート' });
    this.csvExportButton = page.locator('button', { hasText: 'CSVエクスポート' });
    this.employeeTable = page.locator('table');
    this.prevPageButton = page.locator('button').filter({ has: page.locator('svg') }).first();
    this.nextPageButton = page.locator('button').filter({ has: page.locator('svg') }).last();
    this.pageInfo = page.locator('text=/\\d+ \\/ \\d+/');
  }

  async goto() {
    await this.page.goto('/employees');
    await this.page.waitForLoadState('networkidle');
  }

  async search(name: string) {
    await this.searchInput.fill(name);
    await this.page.waitForTimeout(500); // Debounce wait
  }

  async filterByEmploymentType(type: string) {
    await this.employmentTypeFilter.selectOption(type);
    await this.page.waitForLoadState('networkidle');
  }

  async filterByStatus(isActive: boolean) {
    await this.statusFilter.selectOption(isActive ? 'true' : 'false');
    await this.page.waitForLoadState('networkidle');
  }

  async getEmployeeRows() {
    return this.employeeTable.locator('tbody tr');
  }

  async getEmployeeCount() {
    const rows = await this.getEmployeeRows();
    return rows.count();
  }

  async getEmployeeNames() {
    const rows = await this.getEmployeeRows();
    const count = await rows.count();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const name = await rows.nth(i).locator('td').first().textContent();
      if (name) names.push(name.trim());
    }
    return names;
  }

  async clickEmployee(index: number = 0) {
    const rows = await this.getEmployeeRows();
    const editLink = rows.nth(index).locator('a').first();
    await editLink.click();
  }

  async selectEmployee(index: number) {
    const rows = await this.getEmployeeRows();
    const checkbox = rows.nth(index).locator('input[type="checkbox"]');
    await checkbox.click();
  }

  async selectAllEmployees() {
    const headerCheckbox = this.employeeTable.locator('thead input[type="checkbox"]');
    await headerCheckbox.click();
  }

  async getSelectedCount() {
    const selectedButton = this.page.locator('button', { hasText: /\d+件/ });
    const text = await selectedButton.textContent();
    const match = text?.match(/(\d+)件/);
    return match ? parseInt(match[1], 10) : 0;
  }

  async nextPage() {
    await this.nextPageButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async prevPage() {
    await this.prevPageButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async hasActiveStatus(rowIndex: number) {
    const rows = await this.getEmployeeRows();
    const statusBadge = rows.nth(rowIndex).locator('.bg-green-100');
    return statusBadge.isVisible();
  }

  async hasInactiveStatus(rowIndex: number) {
    const rows = await this.getEmployeeRows();
    const statusBadge = rows.nth(rowIndex).locator('.bg-gray-100');
    return statusBadge.isVisible();
  }
}
