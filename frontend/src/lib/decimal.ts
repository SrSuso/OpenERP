import { z } from 'zod';

/**
 * A `NUMERIC(18,6)` sent to/from the API as a plain decimal string — rule 8
 * (money/quantities are `Decimal`, never `float`) applies just as much on
 * this side of the wire. Accepts what a person actually types (comma or
 * dot as the separator), normalises to the dot form the backend expects.
 */
export function decimalString(options: { min?: number } = {}) {
  return z
    .string()
    .trim()
    .transform((value) => value.replace(',', '.'))
    .refine((value) => /^\d+(\.\d{1,6})?$/.test(value), {
      message: 'Introduce un número (hasta 6 decimales).',
    })
    .refine((value) => options.min === undefined || Number(value) >= options.min, {
      message: `Debe ser al menos ${options.min ?? 0}.`,
    });
}
