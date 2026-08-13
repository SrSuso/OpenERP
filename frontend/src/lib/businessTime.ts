/** Formatting and calendar helpers for the shop's configured timezone.
 *
 * API timestamps remain absolute ISO-8601 instants. Date-only form values
 * remain YYYY-MM-DD strings and are deliberately never parsed as instants.
 */

export const DEFAULT_BUSINESS_TIMEZONE = 'Europe/Madrid';

type Instant = string | number | Date;

function instant(value: Instant): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatBusinessDateTime(value: Instant, timezone: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant(value));
}

export function formatBusinessDate(value: Instant, timezone: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(instant(value));
}

export function formatBusinessTime(value: Instant, timezone: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant(value));
}

/** YYYY-MM-DD in the business calendar at one absolute instant. */
export function businessDateAt(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
