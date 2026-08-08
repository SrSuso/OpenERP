import { expect, test, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-pass-123';

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/^email$/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/contraseña/i).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test.describe('bootstrap smoke', () => {
  test('login redirects to the admin panel and reaches the API', async ({ page }) => {
    await loginAsAdmin(page);

    await expect(page.getByRole('heading', { name: /panel de administración/i })).toBeVisible();
    await expect(page.getByTestId('api-status')).toContainText('ok');
  });

  test('an unauthenticated visitor is sent to /login', async ({ page }) => {
    await page.goto('/admin');

    await expect(page).toHaveURL(/\/login$/);
  });

  test('the root path redirects a signed-in admin to the admin panel', async ({ page }) => {
    await loginAsAdmin(page);

    await page.goto('/');

    await expect(page).toHaveURL(/\/admin$/);
  });

  test('logout ends the session and the panel is no longer reachable', async ({ page }) => {
    await loginAsAdmin(page);

    await page.getByRole('button', { name: /salir/i }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('an unknown route shows the not-found page', async ({ page }) => {
    await page.goto('/definitely-not-a-route');

    await expect(page.getByRole('heading', { name: /página no encontrada/i })).toBeVisible();
  });

  test('the API serves its OpenAPI document', async ({ request }) => {
    const response = await request.get('/api/openapi.json');

    expect(response.ok()).toBe(true);
    const schema = (await response.json()) as { info: { title: string } };
    expect(schema.info.title).toBe('OpenERP');
  });
});
