import { Page, Locator } from '@playwright/test';

export class ReportListPage {
  readonly page: Page;
  readonly searchInput: Locator;
  readonly monthFilter: Locator;
  readonly statusFilter: Locator;
  readonly siteFilter: Locator;
  readonly csvExportButton: Locator;
  readonly pdfDownloadButton: Locator;
  readonly reportTable: Locator;
  readonly prevPageButton: Locator;
  readonly nextPageButton: Locator;
  readonly pageInfo: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchInput = page.locator('input[placeholder="現場名・作成者で検索..."]');
    this.monthFilter = page.locator('select').first();
    this.statusFilter = page.locator('select').nth(1);
    this.siteFilter = page.locator('select').nth(2);
    this.csvExportButton = page.locator('button', { hasText: 'CSV出力' });
    this.pdfDownloadButton = page.locator('button', { hasText: 'PDF一括DL' });
    this.reportTable = page.locator('table');
    this.prevPageButton = page.locator('button').filter({ has: page.locator('svg') }).first();
    this.nextPageButton = page.locator('button').filter({ has: page.locator('svg') }).last();
    this.pageInfo = page.locator('text=/\\d+ \\/ \\d+/');
  }

  async goto() {
    await this.page.goto('/reports');
    await this.page.waitForLoadState('networkidle');
  }

  async search(text: string) {
    await this.searchInput.fill(text);
    await this.page.waitForTimeout(500); // Debounce wait
  }

  async filterByStatus(status: 'all' | 'draft' | 'signed' | 'submitted' | 'approved' | 'rejected') {
    const statusMap: Record<string, string> = {
      all: '',
      draft: 'draft',
      signed: 'signed',
      submitted: 'submitted',
      approved: 'approved',
      rejected: 'rejected',
    };
    await this.statusFilter.selectOption(statusMap[status]);
    await this.page.waitForLoadState('networkidle');
  }

  async getReportRows() {
    return this.page.locator('table tbody tr');
  }

  async getReportCount() {
    const rows = await this.getReportRows();
    return rows.count();
  }

  async clickReportDetail(index: number = 0) {
    const rows = await this.getReportRows();
    const detailLink = rows.nth(index).locator('a', { hasText: '詳細' });
    await detailLink.click();
  }

  async getStatusBadges() {
    return this.page.locator('span').filter({
      has: this.page.locator('text=/(下書き|署名済|送信完了|承認済|差戻し)/'),
    });
  }

  async nextPage() {
    await this.nextPageButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async prevPage() {
    await this.prevPageButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async exportCsv(startDate?: string, endDate?: string) {
    await this.csvExportButton.click();

    // Wait for modal
    await this.page.waitForSelector('text=CSV出力');

    if (startDate) {
      await this.page.locator('input[type="date"]').first().fill(startDate);
    }
    if (endDate) {
      await this.page.locator('input[type="date"]').last().fill(endDate);
    }

    await this.page.locator('button', { hasText: 'ダウンロード' }).click();
  }
}
