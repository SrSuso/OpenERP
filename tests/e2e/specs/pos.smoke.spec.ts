import { expect, test } from '@playwright/test';

test.describe('POS shell', () => {
  test('the till loads on its own surface', async ({ page }) => {
    await page.goto('/pos');

    await expect(page.getByRole('heading', { name: /punto de venta/i })).toBeVisible();
  });

  test('the till does not expose the admin navigation', async ({ page }) => {
    await page.goto('/pos');

    await expect(page.getByRole('heading', { name: /punto de venta/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /inicio/i })).toHaveCount(0);
  });
});
