import { type Lot } from '@/features/lots/api';

export type ExpirationFilter = 'all' | 'alert' | 'expired' | 'undated';

export function localExpirationDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year!, month! - 1, day);
}

function todayStart(): Date {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

export function expirationDays(lot: Lot): number | null {
  if (lot.expiration_date === null) return null;
  return Math.round(
    (localExpirationDate(lot.expiration_date).getTime() - todayStart().getTime()) / 86_400_000,
  );
}

export function matchesExpirationFilter(
  lot: Lot,
  filter: ExpirationFilter,
  alertedLotIds: Set<number>,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'alert') return alertedLotIds.has(lot.id);
  if (filter === 'expired') return (expirationDays(lot) ?? 0) < 0 && lot.expiration_date !== null;
  return lot.expiration_date === null;
}
