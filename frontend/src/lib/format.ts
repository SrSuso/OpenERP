/**
 * Every money/quantity value crossing the API is a `NUMERIC(18,6)` encoded
 * as a JSON string (rule 8 — never a float), e.g. `"36.300000"`. These
 * helpers are the one place that turns such a string into something a
 * cashier reads, so a future currency/locale change has one spot to touch.
 */

const MONEY_FORMATTER = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const QUANTITY_FORMATTER = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

export function formatMoney(value: string): string {
  return `${MONEY_FORMATTER.format(Number(value))} €`;
}

export function formatQuantity(value: string): string {
  return QUANTITY_FORMATTER.format(Number(value));
}
