import { expect, test } from '@playwright/test';

test.describe('bootstrap smoke', () => {
  test('the admin panel loads and reaches the API', async ({ page }) => {
    await page.goto('/admin');

    await expect(page.getByRole('heading', { name: /panel de administración/i })).toBeVisible();
    await expect(page.getByTestId('api-status')).toContainText('ok');
  });

  test('the root path redirects to the admin panel', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/admin$/);
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
