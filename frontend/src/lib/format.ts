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

const PERCENT_FORMATTER = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatMoney(value: string): string {
  return `${MONEY_FORMATTER.format(Number(value))} €`;
}

export function formatQuantity(value: string): string {
  return QUANTITY_FORMATTER.format(Number(value));
}

/** A `Rate` (`app.db.types.Rate`) is already a plain percentage number —
 * `"21.000000"` means 21%, not 0.21 — this only trims the trailing zeros
 * NUMERIC(18,6) always carries. */
export function formatRate(value: string): string {
  return PERCENT_FORMATTER.format(Number(value));
}
