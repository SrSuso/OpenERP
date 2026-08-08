import { expect, test, type Page } from '@playwright/test';

const CASHIER_EMAIL = process.env.E2E_CASHIER_EMAIL ?? 'e2e-cashier@example.com';
const CASHIER_PASSWORD = process.env.E2E_CASHIER_PASSWORD ?? 'e2e-cashier-pass-123';

async function loginAsCashier(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/^email$/i).fill(CASHIER_EMAIL);
  await page.getByLabel(/contraseña/i).fill(CASHIER_PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/pos$/);
}

test.describe('POS shell', () => {
  test('a cashier lands on the till, not the admin panel', async ({ page }) => {
    await loginAsCashier(page);

    await expect(page.getByRole('heading', { name: /punto de venta/i })).toBeVisible();
  });

  test('the till does not expose the admin navigation', async ({ page }) => {
    await loginAsCashier(page);

    await expect(page.getByRole('heading', { name: /punto de venta/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /inicio/i })).toHaveCount(0);
  });

  test('a cashier is bounced away from the admin panel (403 at the API, not just hidden)', async ({
    page,
  }) => {
    await loginAsCashier(page);

    await page.goto('/admin');
    // RequirePermission sends them back through `/`, which resolves to their
    // own home — never to /admin, and never to /login (they *are* signed in).
    await expect(page).toHaveURL(/\/pos$/);

    const response = await page.request.get('/api/v1/users');
    expect(response.status()).toBe(403);
  });
});
