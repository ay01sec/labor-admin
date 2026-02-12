import { test, expect } from '@playwright/test';
import { ReportListPage } from '../../pages/report-list.page';
import { ReportDetailPage } from '../../pages/report-detail.page';
import { LoginPage } from '../../pages/login.page';

test.describe('日報詳細機能', () => {
  let reportListPage: ReportListPage;

  test.beforeEach(async ({ page }) => {
    // ログイン
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(
      process.env.TEST_COMPANY_CODE!,
      process.env.TEST_USER_EMAIL!,
      process.env.TEST_USER_PASSWORD!
    );

    // 2FAがある場合の処理
    try {
      const devCode = await page.locator('.font-mono.tracking-widest').textContent({ timeout: 3000 });
      if (devCode) {
        await page.locator('input[maxlength="6"]').fill(devCode);
        await page.locator('button', { hasText: '認証' }).click();
      }
    } catch {
      // 2FAがない場合は無視
    }

    await page.waitForURL('/', { timeout: 15000 });

    reportListPage = new ReportListPage(page);
  });

  test('日報詳細ページが正しく表示される', async ({ page }) => {
    await reportListPage.goto();
    await page.waitForTimeout(2000);

    const reportCount = await reportListPage.getReportCount();

    if (reportCount === 0) {
      test.skip();
      return;
    }

    // 最初の日報の詳細に遷移
    await reportListPage.clickReportDetail(0);
    await page.waitForLoadState('networkidle');

    const reportDetailPage = new ReportDetailPage(page);

    // 基本情報が表示される
    await expect(page.locator('text=/\\d{4}年\\d{1,2}月\\d{1,2}日/')).toBeVisible();

    // 作業員テーブルが表示される
    await expect(reportDetailPage.workerTable).toBeVisible();
  });

  test('承認済み日報でPDFボタンが表示される', async ({ page }) => {
    // 承認済みでフィルター
    await reportListPage.goto();
    await reportListPage.filterByStatus('approved');
    await page.waitForTimeout(2000);

    const reportCount = await reportListPage.getReportCount();

    if (reportCount === 0) {
      test.skip();
      return;
    }

    // 最初の承認済み日報の詳細に遷移
    await reportListPage.clickReportDetail(0);
    await page.waitForLoadState('networkidle');

    const reportDetailPage = new ReportDetailPage(page);

    // PDF表示ボタンが表示される
    await expect(reportDetailPage.pdfButton).toBeVisible();

    // QRコードボタンが表示される
    await expect(reportDetailPage.qrCodeButton).toBeVisible();
  });

  test('送信完了状態の日報で承認・差戻しボタンが表示される', async ({ page }) => {
    // 送信完了でフィルター
    await reportListPage.goto();
    await reportListPage.filterByStatus('submitted');
    await page.waitForTimeout(2000);

    const reportCount = await reportListPage.getReportCount();

    if (reportCount === 0) {
      test.skip();
      return;
    }

    // 最初の送信完了日報の詳細に遷移
    await reportListPage.clickReportDetail(0);
    await page.waitForLoadState('networkidle');

    const reportDetailPage = new ReportDetailPage(page);

    // 承認ボタンが表示される
    await expect(reportDetailPage.approveButton).toBeVisible();

    // 差戻しボタンが表示される
    await expect(reportDetailPage.rejectButton).toBeVisible();
  });

  test('差戻し済み日報で差戻し理由が表示される', async ({ page }) => {
    // 差戻しでフィルター
    await reportListPage.goto();
    await reportListPage.filterByStatus('rejected');
    await page.waitForTimeout(2000);

    const reportCount = await reportListPage.getReportCount();

    if (reportCount === 0) {
      test.skip();
      return;
    }

    // 最初の差戻し日報の詳細に遷移
    await reportListPage.clickReportDetail(0);
    await page.waitForLoadState('networkidle');

    const reportDetailPage = new ReportDetailPage(page);

    // 差戻し情報が表示される
    const isRejected = await reportDetailPage.isRejected();
    expect(isRejected).toBe(true);
  });

  test('戻るボタンで一覧に戻れる', async ({ page }) => {
    await reportListPage.goto();
    await page.waitForTimeout(2000);

    const reportCount = await reportListPage.getReportCount();

    if (reportCount === 0) {
      test.skip();
      return;
    }

    // 最初の日報の詳細に遷移
    await reportListPage.clickReportDetail(0);
    await page.waitForLoadState('networkidle');

    const reportDetailPage = new ReportDetailPage(page);

    // 戻るボタンをクリック
    await reportDetailPage.backButton.click();

    // 一覧ページに戻る
    await expect(page).toHaveURL('/reports');
  });
});

test.describe('日報承認・差戻し機能', () => {
  test.beforeEach(async ({ page }) => {
    // ログイン
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(
      process.env.TEST_COMPANY_CODE!,
      process.env.TEST_USER_EMAIL!,
      process.env.TEST_USER_PASSWORD!
    );

    // 2FAがある場合の処理
    try {
      const devCode = await page.locator('.font-mono.tracking-widest').textContent({ timeout: 3000 });
      if (devCode) {
        await page.locator('input[maxlength="6"]').fill(devCode);
        await page.locator('button', { hasText: '認証' }).click();
      }
    } catch {
      // 2FAがない場合は無視
    }

    await page.waitForURL('/', { timeout: 15000 });
  });

  test('日報を承認できる', async ({ page }) => {
    const reportListPage = new ReportListPage(page);
    await reportListPage.goto();
    await reportListPage.filterByStatus('submitted');
    await page.waitForTimeout(2000);

    const reportCount = await reportListPage.getReportCount();

    if (reportCount === 0) {
      test.skip();
      return;
    }

    // 最初の送信完了日報の詳細に遷移
    await reportListPage.clickReportDetail(0);
    await page.waitForLoadState('networkidle');

    const reportDetailPage = new ReportDetailPage(page);

    // 承認ボタンをクリック
    await reportDetailPage.approve();

    // 承認が成功したことを確認（承認情報が表示される）
    await expect(reportDetailPage.approvalInfo).toBeVisible({ timeout: 10000 });
  });

  test('差戻しモーダルが開く', async ({ page }) => {
    const reportListPage = new ReportListPage(page);
    await reportListPage.goto();
    await reportListPage.filterByStatus('submitted');
    await page.waitForTimeout(2000);

    const reportCount = await reportListPage.getReportCount();

    if (reportCount === 0) {
      test.skip();
      return;
    }

    // 最初の送信完了日報の詳細に遷移
    await reportListPage.clickReportDetail(0);
    await page.waitForLoadState('networkidle');

    const reportDetailPage = new ReportDetailPage(page);

    // 差戻しボタンをクリック
    await reportDetailPage.rejectButton.click();

    // モーダルが開く
    await expect(page.locator('text=差戻し理由')).toBeVisible();
    await expect(page.locator('textarea')).toBeVisible();
    await expect(page.locator('button', { hasText: '差戻しする' })).toBeVisible();
  });
});
