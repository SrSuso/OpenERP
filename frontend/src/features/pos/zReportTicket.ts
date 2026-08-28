import { type ZReport } from '@/features/pos/api';
import { type TicketPrintProfile } from '@/features/tickets/api';
import { printableCharacters } from '@/features/tickets/printProfile';
import { formatMoney } from '@/lib/format';

function ticketRow(label: string, value: string, width: number): string[] {
  const available = width - value.length - 1;
  if (label.length <= available)
    return [`${label}${' '.repeat(available - label.length)} ${value}`];
  return [label, `${' '.repeat(Math.max(0, width - value.length))}${value}`];
}

/** Convierte el cierre ya guardado en un recibo térmico. No recalcula ni
 * consulta ventas: una reimpresión debe conservar exactamente los totales
 * que quedaron congelados en la Z original. */
export function renderZReportTicket(
  report: ZReport,
  closedAtLabel: string,
  profile: TicketPrintProfile,
): string {
  const width = printableCharacters(profile);
  const separator = '-'.repeat(width);
  const rows = [
    ...ticketRow('Ventas cobradas', String(report.sales_count), width),
    ...ticketRow('Efectivo', formatMoney(report.cash_total), width),
    ...ticketRow('Tarjeta', formatMoney(report.card_total), width),
    ...ticketRow('Otros', formatMoney(report.other_total), width),
  ];
  if (Number(report.returns_total) > 0) {
    rows.push(
      ...ticketRow(
        `Devoluciones (${report.returns_count})`,
        `− ${formatMoney(report.returns_total)}`,
        width,
      ),
    );
  }

  return [
    `CIERRE Z Nº ${report.number}`,
    closedAtLabel,
    separator,
    ...rows,
    separator,
    ...ticketRow('TOTAL COBRADO', formatMoney(report.gross_total), width),
    ...ticketRow('IVA', formatMoney(report.tax_total), width),
  ]
    .map((line) => (line.length >= width ? line.slice(0, width) : line))
    .join('\n');
}
