import { expect, test, type Page } from "@playwright/test";

import { openPreparedPos } from "../helpers/pos";

// Seeded by `make seed-e2e-catalog` (backend/scripts/seed_e2e_catalog.py) —
// idempotent, so it is safe to assume this catalog exists whenever this
// suite runs (CI seeds it explicitly; see docs/USAGE.md for local dev).
const MILK_NAME = /leche entera 1l/i;
const WATER_BARCODE = "8410000000027";
const PRINTED_TICKET_KEY = "openerp.e2e.printedTicket";

async function captureBrowserPrint(page: Page): Promise<void> {
  // window.print() opens real OS/browser chrome Playwright cannot drive.
  // Capture the real rendered text at that boundary; the backend request,
  // template rendering and automatic dismissal still run unchanged.
  await page.addInitScript((storageKey) => {
    window.print = () => {
      const text =
        document.querySelector(".ticket-print-root pre")?.textContent ?? "";
      window.sessionStorage.setItem(storageKey, text);
    };
  }, PRINTED_TICKET_KEY);
  await page.goto("/pos");
}

async function waitForPrintedTicket(page: Page): Promise<string> {
  await expect
    .poll(() =>
      page.evaluate(
        (storageKey) => window.sessionStorage.getItem(storageKey),
        PRINTED_TICKET_KEY,
      ),
    )
    .toMatch(/Venta #\d+/);
  return (
    (await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      PRINTED_TICKET_KEY,
    )) ?? ""
  );
}

/**
 * Cancelling always succeeds on an open `DRAFT` sale, empty or not (phase
 * 11), so this gives every test a known-empty cart to start from — running
 * this suite twice against the same database must not make the second run
 * see leftovers from the first.
 */
async function resetCart(page: Page) {
  await page.getByRole("button", { name: /cancelar venta/i }).click();
  await expect(page.getByText(/el carrito está vacío/i)).toBeVisible();
}

// Every test here shares the one `DRAFT` sale a warehouse can have resumed
// at a time (phase 11/12 have no per-terminal session, only per-warehouse) —
// run serially so two of *these* tests never race each other over it. (This
// spec is the only one that mutates a sale; specs that merely load `/pos`
// cannot collide with it the same way.)
test.describe.serial("POS cart & checkout (phases 12/13)", () => {
  test.beforeEach(async ({ page }) => {
    await openPreparedPos(page);
    await resetCart(page);
  });

  test("tapping a product on its category tab adds it to the cart, and removing it empties it again", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Bebidas" }).click();
    await page.getByRole("button", { name: MILK_NAME }).click();

    await expect(page.getByText(/el carrito está vacío/i)).not.toBeVisible();
    const removeButton = page.getByRole("button", {
      name: /quitar leche entera 1l/i,
    });
    await expect(removeButton).toBeVisible();

    await removeButton.click();

    await expect(page.getByText(/el carrito está vacío/i)).toBeVisible();
  });

  test("a barcode can be typed straight in, without touching the grid", async ({
    page,
  }) => {
    await page.getByLabel(/código de barras/i).fill(WATER_BARCODE);
    await page.getByRole("button", { name: /^añadir$/i }).click();

    await expect(
      page.getByRole("button", { name: /quitar agua mineral 1\.5l/i }),
    ).toBeVisible();
  });

  test("cancelling the sale clears the cart and the till is immediately usable again", async ({
    page,
  }) => {
    await page.getByRole("button", { name: MILK_NAME }).click();
    await expect(page.getByText(/el carrito está vacío/i)).not.toBeVisible();

    await page.getByRole("button", { name: /cancelar venta/i }).click();
    await expect(page.getByText(/el carrito está vacío/i)).toBeVisible();

    await page.getByRole("button", { name: MILK_NAME }).click();
    await expect(page.getByText(/el carrito está vacío/i)).not.toBeVisible();
  });

  test("reloading the page resumes the same open sale instead of losing it", async ({
    page,
  }) => {
    await page.getByRole("button", { name: MILK_NAME }).click();
    await expect(page.getByText(/el carrito está vacío/i)).not.toBeVisible();

    await page.reload();

    await expect(
      page.getByRole("button", { name: /quitar leche entera 1l/i }),
    ).toBeVisible();
  });

  test("checking out with exact cash shows a receipt, and a fresh sale is ready right after", async ({
    page,
  }) => {
    await page.getByRole("button", { name: MILK_NAME }).click();
    await page.getByRole("button", { name: /^cobrar$/i }).click();

    await expect(
      page.getByRole("heading", { name: /^cobrar$/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: /confirmar cobro/i }).click();

    await expect(page.getByText(/venta cobrada/i)).toBeVisible();
    // Auto-print is enabled by default. Once the real ticket request has
    // completed, Receipt dismisses itself and opens the next sale; clicking
    // its short-lived fallback button races that documented transition.
    await expect(page.getByText(/el carrito está vacío/i)).toBeVisible();
  });

  test("auto-print sends the rendered receipt text to the browser", async ({
    page,
  }) => {
    await captureBrowserPrint(page);
    await page.getByRole("button", { name: MILK_NAME }).click();
    await page.getByRole("button", { name: /^cobrar$/i }).click();
    await page.getByRole("button", { name: /confirmar cobro/i }).click();
    await expect(page.getByText(/venta cobrada/i)).toBeVisible();

    const printedTicket = await waitForPrintedTicket(page);
    expect(printedTicket).toMatch(MILK_NAME);
    await expect(page.getByText(/el carrito está vacío/i)).toBeVisible();
  });

  test("a cash overpayment reaches the printed receipt with the correct change", async ({
    page,
  }) => {
    await captureBrowserPrint(page);
    await page.getByRole("button", { name: MILK_NAME }).click(); // 1,20 €
    await page.getByRole("button", { name: /^cobrar$/i }).click();

    await page.getByLabel(/importe recibido/i).fill("2.00");
    await expect(page.getByText("0,80 €")).toBeVisible();
    await page.getByRole("button", { name: /confirmar cobro/i }).click();

    const printedTicket = await waitForPrintedTicket(page);
    expect(printedTicket).toMatch(/Cambio\s+0\.80/);
    await expect(page.getByText(/el carrito está vacío/i)).toBeVisible();
  });

  test('"Volver" from checkout returns to the cart without charging', async ({
    page,
  }) => {
    await page.getByRole("button", { name: MILK_NAME }).click();
    await page.getByRole("button", { name: /^cobrar$/i }).click();

    await page.getByRole("button", { name: /volver/i }).click();

    await expect(
      page.getByRole("button", { name: /quitar leche entera 1l/i }),
    ).toBeVisible();
  });
});
