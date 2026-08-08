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

/**
 * `AdminHomePage` always renders the *first* dashboard (phase 16 has no
 * per-user scoping yet — see its own deuda técnica), so it is shared
 * across every run of this suite against the same database. Delete
 * whatever widgets a previous run left on it before each test, the same
 * reasoning as `resetCart` in `pos.sale.spec.ts`: running this suite
 * twice must not make the second run see leftovers from the first, and a
 * widget's title is exactly what these tests assert on.
 */
async function resetDashboard(page: Page) {
  const response = await page.request.get('/api/v1/dashboards');
  const dashboards = (await response.json()) as { id: number; widgets: { id: number }[] }[];
  const dashboard = dashboards[0];
  if (!dashboard) {
    return;
  }
  for (const widget of dashboard.widgets) {
    await page.request.delete(`/api/v1/dashboards/${dashboard.id}/widgets/${widget.id}`);
  }
}

// Every test here shares the one dashboard AdminHomePage renders (phase 16
// has no per-user dashboard scoping yet) — run serially so two of *these*
// tests never race each other adding/removing widgets on it, same
// reasoning as pos.sale.spec.ts's cart tests.
test.describe.serial('Admin dashboard (phase 16)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await resetDashboard(page);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: /panel de administración/i })).toBeVisible();
  });

  test('a KPI widget can be added and shows a live value', async ({ page }) => {
    await page.getByRole('button', { name: /añadir widget/i }).click();
    await page.getByLabel(/métrica/i).selectOption('Valor del inventario');
    await page.getByRole('button', { name: /^añadir$/i }).click();

    await expect(page.getByText('Valor del inventario')).toBeVisible();
    // Whatever it is, it's a currency figure, not the "preparing" state.
    await expect(page.getByText(/€/)).toBeVisible();
  });

  test('a chart widget renders an actual chart canvas', async ({ page }) => {
    await page.getByRole('button', { name: /añadir widget/i }).click();
    await page.getByLabel(/métrica/i).selectOption('Ventas por día');
    await page.getByRole('button', { name: /^añadir$/i }).click();

    await expect(page.getByText('Ventas por día')).toBeVisible();
    await expect(page.getByTestId('echart').locator('canvas')).toBeVisible();
  });

  test('removing a widget takes it off the dashboard', async ({ page }) => {
    await page.getByRole('button', { name: /añadir widget/i }).click();
    await page.getByLabel(/métrica/i).selectOption('Productos más vendidos');
    await page.getByRole('button', { name: /^añadir$/i }).click();
    await expect(page.getByText('Productos más vendidos')).toBeVisible();

    await page.getByRole('button', { name: /quitar productos más vendidos/i }).click();

    await expect(page.getByText('Productos más vendidos')).not.toBeVisible();
  });

  test('"Cancelar" closes the add-widget form without adding anything', async ({ page }) => {
    await page.getByRole('button', { name: /añadir widget/i }).click();
    await page.getByRole('button', { name: /^cancelar$/i }).click();

    await expect(page.getByLabel(/métrica/i)).not.toBeVisible();
  });
});
