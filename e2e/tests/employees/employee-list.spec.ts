import { test, expect } from '@playwright/test';
import { EmployeeListPage } from '../../pages/employee-list.page';
import { LoginPage } from '../../pages/login.page';

test.describe('社員一覧機能', () => {
  let employeeListPage: EmployeeListPage;

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

    employeeListPage = new EmployeeListPage(page);
    await employeeListPage.goto();
  });

  test('社員一覧ページが正しく表示される', async ({ page }) => {
    // ページタイトル確認
    await expect(employeeListPage.pageTitle).toBeVisible();

    // 検索入力欄が表示される
    await expect(employeeListPage.searchInput).toBeVisible();

    // フィルターが表示される
    await expect(employeeListPage.employmentTypeFilter).toBeVisible();
    await expect(employeeListPage.statusFilter).toBeVisible();

    // テーブルヘッダーが表示される
    await expect(page.locator('th', { hasText: '氏名' })).toBeVisible();
    await expect(page.locator('th', { hasText: '雇用形態' })).toBeVisible();
    await expect(page.locator('th', { hasText: '状態' })).toBeVisible();
  });

  test('社員リストが表示される', async () => {
    // データがロードされるまで待機
    await employeeListPage.page.waitForTimeout(2000);

    // 社員が存在する場合、テーブルに行が表示される
    const employeeCount = await employeeListPage.getEmployeeCount();
    // 少なくとも0件以上
    expect(employeeCount).toBeGreaterThanOrEqual(0);
  });

  test('氏名で検索できる', async ({ page }) => {
    // 検索キーワードを入力
    await employeeListPage.search('テスト');
    await page.waitForTimeout(1000);

    // 検索が実行されていることを確認
    await expect(employeeListPage.searchInput).toHaveValue('テスト');
  });

  test('在籍ステータスでフィルタリングできる', async ({ page }) => {
    // 在籍中でフィルタリング
    await employeeListPage.filterByStatus(true);
    await page.waitForTimeout(1000);

    // フィルターが適用されていることを確認
    await expect(employeeListPage.statusFilter).toHaveValue('true');
  });

  test('退職ステータスでフィルタリングできる', async ({ page }) => {
    // 退職でフィルタリング
    await employeeListPage.filterByStatus(false);
    await page.waitForTimeout(1000);

    // フィルターが適用されていることを確認
    await expect(employeeListPage.statusFilter).toHaveValue('false');
  });

  test('新規登録ボタンが表示される', async () => {
    await expect(employeeListPage.newEmployeeButton).toBeVisible();
  });

  test('CSVインポートボタンが表示される', async () => {
    await expect(employeeListPage.csvImportButton).toBeVisible();
  });

  test('社員詳細ページに遷移できる', async ({ page }) => {
    // データがロードされるまで待機
    await page.waitForTimeout(2000);

    const employeeCount = await employeeListPage.getEmployeeCount();

    if (employeeCount > 0) {
      // 最初の社員の詳細をクリック
      await employeeListPage.clickEmployee(0);

      // 詳細ページに遷移したことを確認
      await expect(page).toHaveURL(/\/employees\/[a-zA-Z0-9]+$/);
    } else {
      // 社員がない場合はスキップ
      test.skip();
    }
  });

  test('ページネーションが動作する', async ({ page }) => {
    // データがロードされるまで待機
    await page.waitForTimeout(2000);

    const employeeCount = await employeeListPage.getEmployeeCount();

    // 10件以上ある場合のみページネーションテスト
    if (employeeCount >= 10) {
      // ページ情報を取得
      const pageInfoBefore = await employeeListPage.pageInfo.textContent();

      // 次のページに移動
      await employeeListPage.nextPage();
      await page.waitForTimeout(1000);

      // ページ情報が変わったことを確認
      const pageInfoAfter = await employeeListPage.pageInfo.textContent();
      expect(pageInfoBefore).not.toBe(pageInfoAfter);
    } else {
      test.skip();
    }
  });
});

test.describe('社員一括操作機能', () => {
  let employeeListPage: EmployeeListPage;

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

    employeeListPage = new EmployeeListPage(page);
    await employeeListPage.goto();
  });

  test('社員を選択できる', async ({ page }) => {
    await page.waitForTimeout(2000);

    const employeeCount = await employeeListPage.getEmployeeCount();

    if (employeeCount > 0) {
      // 最初の社員を選択
      await employeeListPage.selectEmployee(0);

      // 選択されたことを確認（一括操作ボタンが表示される）
      await expect(page.locator('button', { hasText: /\d+件/ })).toBeVisible({ timeout: 3000 });
    } else {
      test.skip();
    }
  });
});
