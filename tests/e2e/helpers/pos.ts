import { expect, type Page } from "@playwright/test";

const CASHIER_EMAIL =
  process.env.E2E_CASHIER_EMAIL ?? "e2e-cashier@example.com";
const CASHIER_PASSWORD =
  process.env.E2E_CASHIER_PASSWORD ?? "e2e-cashier-pass-123";
const TERMINAL_NAME = process.env.E2E_POS_TERMINAL_NAME ?? "Terminal E2E";
const TERMINAL_STORAGE_KEY = "openerp.pos.terminalId";

type PosTerminal = {
  id: number;
  name: string;
  warehouse_id: number;
  warehouse_name: string;
  is_active: boolean;
};

export async function loginAsCashier(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/^email$/i).fill(CASHIER_EMAIL);
  await page.getByLabel(/contraseña/i).fill(CASHIER_PASSWORD);
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/pos$/);
}

export async function getE2eTerminal(page: Page): Promise<PosTerminal> {
  const response = await page.request.get(
    "/api/v1/pos-terminals?active_only=true",
  );
  expect(
    response.ok(),
    "the authenticated cashier can list active POS terminals",
  ).toBeTruthy();
  const terminals = (await response.json()) as PosTerminal[];
  const terminal = terminals.find(
    (candidate) => candidate.name === TERMINAL_NAME,
  );
  if (terminal === undefined) {
    throw new Error(
      `Active E2E terminal ${JSON.stringify(TERMINAL_NAME)} not found; run make seed-e2e-catalog`,
    );
  }
  return terminal;
}

export async function openPreparedPos(page: Page): Promise<PosTerminal> {
  await loginAsCashier(page);
  const terminal = await getE2eTerminal(page);

  // This is deliberately after the authenticated API lookup: never write a
  // guessed or stale terminal id into the browser merely to bypass the UI.
  await page.evaluate(
    ({ key, terminalId }) =>
      window.localStorage.setItem(key, String(terminalId)),
    { key: TERMINAL_STORAGE_KEY, terminalId: terminal.id },
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /punto de venta/i }),
  ).toBeVisible();
  return terminal;
}

export async function selectedTerminalId(page: Page): Promise<string | null> {
  return page.evaluate(
    (key) => window.localStorage.getItem(key),
    TERMINAL_STORAGE_KEY,
  );
}
