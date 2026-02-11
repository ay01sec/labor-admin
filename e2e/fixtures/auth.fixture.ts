import { test as base, Page } from '@playwright/test';

// Test credentials from environment variables
const TEST_CREDENTIALS = {
  companyCode: process.env.TEST_COMPANY_CODE || '00000001',
  email: process.env.TEST_USER_EMAIL || 'test@example.com',
  password: process.env.TEST_USER_PASSWORD || 'password123',
};

export interface AuthFixtures {
  authenticatedPage: Page;
}

/**
 * Extended test with authentication fixture
 */
export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    // Navigate to login page
    await page.goto('/login');

    // Fill in credentials
    await page.fill('input[placeholder="12345678"]', TEST_CREDENTIALS.companyCode);
    await page.fill('input[type="email"]', TEST_CREDENTIALS.email);
    await page.fill('input[type="password"]', TEST_CREDENTIALS.password);

    // Submit form
    await page.click('button[type="submit"]');

    // Handle 2FA if it appears (development mode shows devCode)
    try {
      const twoFAInput = page.locator('input[maxlength="6"]');
      const isVisible = await twoFAInput.isVisible({ timeout: 3000 });

      if (isVisible) {
        // Try to get devCode (shown in development when SMTP is not configured)
        const devCodeElement = page.locator('.font-mono.tracking-widest');
        const devCode = await devCodeElement.textContent({ timeout: 2000 }).catch(() => null);

        if (devCode) {
          await twoFAInput.fill(devCode.replace(/\D/g, ''));
          await page.click('button:has-text("認証")');
        }
      }
    } catch {
      // 2FA not required, continue
    }

    // Wait for navigation to dashboard
    await page.waitForURL('/', { timeout: 15000 });

    await use(page);
  },
});

export { expect } from '@playwright/test';
