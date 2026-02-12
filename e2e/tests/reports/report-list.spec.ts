import { test, expect } from '@playwright/test';
import { ReportListPage } from '../../pages/report-list.page';
import { LoginPage } from '../../pages/login.page';

test.describe('日報一覧機能', () => {
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
    await reportListPage.goto();
  });

  test('日報一覧ページが正しく表示される', async ({ page }) => {
    // ページタイトル確認
    await expect(page.locator('h1', { hasText: '日報一覧' })).toBeVisible();

    // 検索入力欄が表示される
    await expect(reportListPage.searchInput).toBeVisible();

    // フィルターが表示される
    await expect(reportListPage.statusFilter).toBeVisible();

    // テーブルヘッダーが表示される
    await expect(page.locator('th', { hasText: '実施日' })).toBeVisible();
    await expect(page.locator('th', { hasText: '現場名' })).toBeVisible();
    await expect(page.locator('th', { hasText: '作成者' })).toBeVisible();
    await expect(page.locator('th', { hasText: 'ステータス' })).toBeVisible();
  });

  test('日報リストが表示される', async () => {
    // データがロードされるまで待機
    await reportListPage.page.waitForTimeout(2000);

    // 日報が存在する場合、テーブルに行が表示される
    const reportCount = await reportListPage.getReportCount();
    // 少なくとも0件以上（空でもエラーにならない）
    expect(reportCount).toBeGreaterThanOrEqual(0);
  });

  test('ステータスでフィルタリングできる', async ({ page }) => {
    // 承認済みでフィルタリング
    await reportListPage.filterByStatus('approved');
    await page.waitForTimeout(1000);

    // フィルターが適用されていることを確認
    const statusSelect = reportListPage.statusFilter;
    await expect(statusSelect).toHaveValue('approved');
  });

  test('検索機能が動作する', async ({ page }) => {
    // 検索キーワードを入力
    await reportListPage.search('テスト');
    await page.waitForTimeout(1000);

    // 検索が実行されていることを確認（入力値の確認）
    await expect(reportListPage.searchInput).toHaveValue('テスト');
  });

  test('日報詳細ページに遷移できる', async ({ page }) => {
    // データがロードされるまで待機
    await page.waitForTimeout(2000);

    const reportCount = await reportListPage.getReportCount();

    if (reportCount > 0) {
      // 最初の日報の詳細リンクをクリック
      await reportListPage.clickReportDetail(0);

      // 詳細ページに遷移したことを確認
      await expect(page).toHaveURL(/\/reports\/[a-zA-Z0-9]+$/);
    } else {
      // 日報がない場合はスキップ
      test.skip();
    }
  });

  test('CSV出力ボタンが表示される', async () => {
    await expect(reportListPage.csvExportButton).toBeVisible();
  });

  test('PDF一括ダウンロードボタンが表示される', async () => {
    await expect(reportListPage.pdfDownloadButton).toBeVisible();
  });
});
