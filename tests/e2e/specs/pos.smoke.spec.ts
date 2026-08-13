import { expect, test } from "@playwright/test";

import {
  getE2eTerminal,
  loginAsCashier,
  openPreparedPos,
  selectedTerminalId,
} from "../helpers/pos";

test.describe("POS shell", () => {
  test("a cashier selects a real terminal through the UI before using the till", async ({
    page,
  }) => {
    await loginAsCashier(page);
    await expect(
      page.getByRole("heading", { name: /seleccionar terminal/i }),
    ).toBeVisible();
    const terminal = await getE2eTerminal(page);

    await page.getByRole("button").filter({ hasText: terminal.name }).click();

    await expect(
      page.getByRole("heading", { name: /punto de venta/i }),
    ).toBeVisible();
    expect(await selectedTerminalId(page)).toBe(String(terminal.id));
  });

  test("the till does not expose the admin navigation", async ({ page }) => {
    await openPreparedPos(page);

    await expect(
      page.getByRole("heading", { name: /punto de venta/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /inicio/i })).toHaveCount(0);
  });

  test("a cashier is bounced away from the admin panel (403 at the API, not just hidden)", async ({
    page,
  }) => {
    await openPreparedPos(page);

    await page.goto("/admin");
    // RequirePermission sends them back through `/`, which resolves to their
    // own home — never to /admin, and never to /login (they *are* signed in).
    await expect(page).toHaveURL(/\/pos$/);

    const response = await page.request.get("/api/v1/users");
    expect(response.status()).toBe(403);
  });
});
