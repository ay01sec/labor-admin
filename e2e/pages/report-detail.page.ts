import { Page, Locator } from '@playwright/test';

export class ReportDetailPage {
  readonly page: Page;
  readonly backButton: Locator;
  readonly editButton: Locator;
  readonly approveButton: Locator;
  readonly rejectButton: Locator;
  readonly statusBadge: Locator;
  readonly pdfButton: Locator;
  readonly qrCodeButton: Locator;
  readonly workerTable: Locator;
  readonly signatureImage: Locator;
  readonly approvalInfo: Locator;
  readonly rejectionInfo: Locator;

  constructor(page: Page) {
    this.page = page;
    this.backButton = page.locator('button').filter({ has: page.locator('svg') }).first();
    this.editButton = page.locator('button', { hasText: '編集' });
    this.approveButton = page.locator('button', { hasText: '承認する' });
    this.rejectButton = page.locator('button', { hasText: '差戻し' });
    this.statusBadge = page.locator('span').filter({
      has: page.locator('text=/(下書き|署名済|送信完了|承認済|差戻し)/'),
    });
    this.pdfButton = page.locator('a', { hasText: 'PDF表示' });
    this.qrCodeButton = page.locator('button', { hasText: 'QRコード' });
    this.workerTable = page.locator('table');
    this.signatureImage = page.locator('img[alt="元請サイン"]');
    this.approvalInfo = page.locator('.bg-green-50');
    this.rejectionInfo = page.locator('.bg-red-50');
  }

  async goto(reportId: string) {
    await this.page.goto(`/reports/${reportId}`);
    await this.page.waitForLoadState('networkidle');
  }

  async getReportDate() {
    const dateElement = this.page.locator('text=/\\d{4}年\\d{1,2}月\\d{1,2}日/');
    return dateElement.textContent();
  }

  async getSiteName() {
    // Find site name after MapPin icon
    const siteElement = this.page.locator('div').filter({ hasText: /^.+$/ }).nth(1);
    return siteElement.textContent();
  }

  async getCreatorName() {
    const creatorElement = this.page.locator('div').filter({ hasText: '作成者' }).locator('+ div');
    return creatorElement.textContent();
  }

  async getWorkerCount() {
    const rows = this.workerTable.locator('tbody tr');
    return rows.count();
  }

  async getWorkerNames() {
    const rows = this.workerTable.locator('tbody tr');
    const count = await rows.count();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const name = await rows.nth(i).locator('td').first().textContent();
      if (name) names.push(name);
    }
    return names;
  }

  async approve() {
    await this.approveButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async reject(reason: string) {
    await this.rejectButton.click();
    // Wait for modal
    await this.page.waitForSelector('text=差戻し理由');
    await this.page.locator('textarea').fill(reason);
    await this.page.locator('button', { hasText: '差戻しする' }).click();
    await this.page.waitForLoadState('networkidle');
  }

  async openEdit() {
    await this.editButton.click();
    // Wait for modal
    await this.page.waitForSelector('text=日報編集');
  }

  async hasSignature() {
    return this.signatureImage.isVisible();
  }

  async isApproved() {
    return this.approvalInfo.isVisible();
  }

  async isRejected() {
    return this.rejectionInfo.isVisible();
  }

  async getRejectionReason() {
    if (await this.isRejected()) {
      return this.rejectionInfo.locator('p').textContent();
    }
    return null;
  }

  async openQrCode() {
    await this.qrCodeButton.click();
    await this.page.waitForSelector('img[alt="QRコード"]');
  }

  async closeQrCode() {
    await this.page.locator('button').filter({ has: this.page.locator('svg') }).click();
  }
}
