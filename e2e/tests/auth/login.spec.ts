import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/login.page';

test.describe('ログイン機能', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
  });

  test('ログインページが正しく表示される', async ({ page }) => {
    // Title
    await expect(page.locator('text=管理画面にログイン')).toBeVisible();

    // Form elements
    await expect(loginPage.companyCodeInput).toBeVisible();
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.submitButton).toBeVisible();

    // Links
    await expect(loginPage.forgotPasswordLink).toBeVisible();
    await expect(loginPage.registerLink).toBeVisible();
  });

  test('企業IDが8桁未満の場合エラーが表示される', async () => {
    await loginPage.login('1234567', 'test@example.com', 'password123');

    await expect(loginPage.errorMessage).toBeVisible();
    await expect(loginPage.errorMessage).toContainText('8桁');
  });

  test('企業IDには数字のみ入力できる', async () => {
    await loginPage.companyCodeInput.fill('abc12345xyz');

    const value = await loginPage.companyCodeInput.inputValue();
    expect(value).toBe('12345');
  });

  test('不正な認証情報でエラーが表示される', async ({ page }) => {
    await loginPage.login('99999999', 'wrong@example.com', 'wrongpassword');

    // Wait for error message
    await expect(loginPage.errorMessage).toBeVisible({ timeout: 10000 });
  });

  test('パスワードを忘れた場合のリンクが機能する', async ({ page }) => {
    await loginPage.forgotPasswordLink.click();

    await expect(page).toHaveURL('/forgot-password');
  });

  test('新規利用開始リンクが機能する', async ({ page }) => {
    await loginPage.registerLink.click();

    await expect(page).toHaveURL('/register');
  });
});

test.describe('認証済みユーザー', () => {
  test('正しい認証情報でログインできる', async ({ page }) => {
    // This test requires valid test credentials
    // Skip by default - enable when TEST_COMPANY_CODE, TEST_USER_EMAIL, TEST_USER_PASSWORD are set
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.login(
      process.env.TEST_COMPANY_CODE!,
      process.env.TEST_USER_EMAIL!,
      process.env.TEST_USER_PASSWORD!
    );

    // Handle 2FA if required
    const twoFAInput = page.locator('input[maxlength="6"]');
    const isTwoFA = await twoFAInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (isTwoFA) {
      // Try to get devCode
      const devCodeElement = page.locator('.font-mono.tracking-widest');
      const devCode = await devCodeElement.textContent({ timeout: 2000 }).catch(() => null);

      if (devCode) {
        await twoFAInput.fill(devCode.replace(/\D/g, ''));
        await page.click('button:has-text("認証")');
      }
    }

    // Should redirect to dashboard
    await expect(page).toHaveURL('/', { timeout: 15000 });
  });
});
