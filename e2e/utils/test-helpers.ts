import { Page } from '@playwright/test';

/**
 * Wait for network to be idle
 */
export async function waitForNetworkIdle(page: Page, timeout = 5000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout });
}

/**
 * Wait for element to be stable (no animations)
 */
export async function waitForStable(page: Page, selector: string, timeout = 5000): Promise<void> {
  const element = page.locator(selector);
  await element.waitFor({ state: 'visible', timeout });
  await page.waitForTimeout(100); // Brief pause for animations
}

/**
 * Take a screenshot with timestamp
 */
export async function takeScreenshot(page: Page, name: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await page.screenshot({ path: `test-results/screenshots/${name}-${timestamp}.png` });
}

/**
 * Fill form fields from an object
 */
export async function fillForm(page: Page, fields: Record<string, string>): Promise<void> {
  for (const [selector, value] of Object.entries(fields)) {
    await page.fill(selector, value);
  }
}
