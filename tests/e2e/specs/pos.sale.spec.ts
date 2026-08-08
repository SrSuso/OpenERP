import { expect, test, type Page } from '@playwright/test';

// Seeded by `make seed-e2e-catalog` (backend/scripts/seed_e2e_catalog.py) —
// idempotent, so it is safe to assume this catalog exists whenever this
// suite runs (CI seeds it explicitly; see docs/USAGE.md for local dev).
const MILK_NAME = /leche entera 1l/i;
const WATER_BARCODE = '8410000000027';

const CASHIER_EMAIL = process.env.E2E_CASHIER_EMAIL ?? 'e2e-cashier@example.com';
const CASHIER_PASSWORD = process.env.E2E_CASHIER_PASSWORD ?? 'e2e-cashier-pass-123';

async function loginAsCashier(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/^email$/i).fill(CASHIER_EMAIL);
  await page.getByLabel(/contraseña/i).fill(CASHIER_PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/pos$/);
}

/**
 * Cancelling always succeeds on an open `DRAFT` sale, empty or not (phase
 * 11), so this gives every test a known-empty cart to start from — running
 * this suite twice against the same database must not make the second run
 * see leftovers from the first.
 */
async function resetCart(page: Page) {
  await page.getByRole('button', { name: /cancelar venta/i }).click();
  await expect(page.getByText(/el carrito está vacío/i)).toBeVisible();
}

// Every test here shares the one `DRAFT` sale a warehouse can have resumed
// at a time (phase 11/12 have no per-terminal session, only per-warehouse) —
// run serially so two of *these* tests never race each other over it. (This
// spec is the only one that mutates a sale; specs that merely load `/pos`
// cannot collide with it the same way.)
test.describe.serial('POS cart & checkout (phases 12/13)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsCashier(page);
    await resetCart(page);
  });

  test('tapping a product on its category tab adds it to the cart, and removing it empties it again', async ({
    page,
  }) => {
    await page.getByRole('tab', { name: 'Bebidas' }).click();
    await page.getByRole('button', { name: MILK_NAME }).click();

    await expect(page.getByText(/el carrito está vacío/i)).not.toBeVisible();
    const removeButton = page.getByRole('button', { name: /quitar leche entera 1l/i });
    await expect(removeButton).toBeVisible();

    await removeButton.click();

    await expect(page.getByText(/el carrito está vacío/i)).toBeVisible();
  });

  test('a barcode can be typed straight in, without touching the grid', async ({ page }) => {
    await page.getByLabel(/código de barras/i).fill(WATER_BARCODE);
    await page.getByRole('button', { name: /^añadir$/i }).click();

    await expect(page.getByRole('button', { name: /quitar agua mineral 1\.5l/i })).toBeVisible();
  });

  test('cancelling the sale clears the cart and the till is immediately usable again', async ({
    page,
  }) => {
    await page.getByRole('button', { name: MILK_NAME }).click();
    await expect(page.getByText(/el carrito está vacío/i)).not.toBeVisible();

    await page.getByRole('button', { name: /cancelar venta/i }).click();
    await expect(page.getByText(/el carrito está vacío/i)).toBeVisible();

    await page.getByRole('button', { name: MILK_NAME }).click();
    await expect(page.getByText(/el carrito está vacío/i)).not.toBeVisible();
  });

  test('reloading the page resumes the same open sale instead of losing it', async ({ page }) => {
    await page.getByRole('button', { name: MILK_NAME }).click();
    await expect(page.getByText(/el carrito está vacío/i)).not.toBeVisible();

    await page.reload();

    await expect(page.getByRole('button', { name: /quitar leche entera 1l/i })).toBeVisible();
  });

  test('checking out with exact cash shows a receipt, and a fresh sale is ready right after', async ({
    page,
  }) => {
    await page.getByRole('button', { name: MILK_NAME }).click();
    await page.getByRole('button', { name: /^cobrar$/i }).click();

    await expect(page.getByRole('heading', { name: /^cobrar$/i })).toBeVisible();
    await page.getByRole('button', { name: /confirmar cobro/i }).click();

    await expect(page.getByText(/venta cobrada/i)).toBeVisible();
    await page.getByRole('button', { name: /nueva venta/i }).click();

    await expect(page.getByText(/el carrito está vacío/i)).toBeVisible();
  });

  test('printing the ticket shows the rendered receipt text', async ({ page }) => {
    // window.print() opens real OS/browser chrome Playwright can't drive —
    // stub it so the test only exercises the app's own logic up to that
    // call, same as any other E2E suite that has to cross this boundary.
    await page.addInitScript(() => {
      window.print = () => {};
    });
    await page.goto('/pos');
    await page.getByRole('button', { name: MILK_NAME }).click();
    await page.getByRole('button', { name: /^cobrar$/i }).click();
    await page.getByRole('button', { name: /confirmar cobro/i }).click();
    await expect(page.getByText(/venta cobrada/i)).toBeVisible();

    await page.getByRole('button', { name: /imprimir ticket/i }).click();

    await expect(page.getByText(/Venta #\d+/)).toBeVisible();
    await expect(page.getByText(MILK_NAME)).toBeVisible();

    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(page.getByRole('button', { name: /nueva venta/i })).toBeVisible();
  });

  test('a cash overpayment shows the change due on the receipt', async ({ page }) => {
    await page.getByRole('button', { name: MILK_NAME }).click(); // 1,32 €
    await page.getByRole('button', { name: /^cobrar$/i }).click();

    await page.getByLabel(/importe recibido/i).fill('2.00');
    await page.getByRole('button', { name: /confirmar cobro/i }).click();

    await expect(page.getByText(/cambio a entregar/i)).toBeVisible();
    await expect(page.getByText('0,68 €')).toBeVisible();
    await page.getByRole('button', { name: /nueva venta/i }).click();
  });

  test('"Volver" from checkout returns to the cart without charging', async ({ page }) => {
    await page.getByRole('button', { name: MILK_NAME }).click();
    await page.getByRole('button', { name: /^cobrar$/i }).click();

    await page.getByRole('button', { name: /volver/i }).click();

    await expect(page.getByRole('button', { name: /quitar leche entera 1l/i })).toBeVisible();
  });
});
