import { type XReportPreview, type ZReport } from '@/features/pos/api';
import { type TicketPrintProfile } from '@/features/tickets/api';
import { printableCharacters } from '@/features/tickets/printProfile';
import { formatMoney } from '@/lib/format';

type ReportTotals = Pick<
  XReportPreview,
  | 'sales_count'
  | 'gross_total'
  | 'tax_total'
  | 'discount_total'
  | 'cash_total'
  | 'card_total'
  | 'other_total'
  | 'returns_count'
  | 'returns_total'
  | 'first_sale_number'
  | 'last_sale_number'
  | 'tax_breakdown'
  | 'payment_breakdown'
  | 'terminal_breakdown'
  | 'cashier_breakdown'
>;

function fit(line: string, width: number): string {
  return line.length > width ? line.slice(0, width) : line;
}

function ticketRow(label: string, value: string, width: number): string[] {
  const available = width - value.length - 1;
  if (label.length <= available) {
    return [`${label}${' '.repeat(available - label.length)} ${value}`];
  }
  return [fit(label, width), `${' '.repeat(Math.max(0, width - value.length))}${value}`];
}

function centered(line: string, width: number): string {
  const trimmed = fit(line, width);
  return `${' '.repeat(Math.max(0, Math.floor((width - trimmed.length) / 2)))}${trimmed}`;
}

function paymentLabel(method: string): string {
  return (
    { CASH: 'Efectivo', CARD: 'Tarjeta', OTHER: 'Otros', UNKNOWN: 'Sin identificar' }[method] ??
    method
  );
}

function totalsRows(report: ReportTotals, width: number): string[] {
  const separator = '-'.repeat(width);
  const rows = [
    ...ticketRow('Ventas cobradas', String(report.sales_count), width),
    ...ticketRow(
      'Tickets',
      `${report.first_sale_number ?? '—'} - ${report.last_sale_number ?? '—'}`,
      width,
    ),
  ];
  if (Number(report.discount_total) > 0) {
    rows.push(...ticketRow('Descuentos', `− ${formatMoney(report.discount_total)}`, width));
  }
  rows.push(separator, ...ticketRow('VENTAS BRUTAS', formatMoney(report.gross_total), width));

  if (report.tax_breakdown.length > 0) {
    rows.push('IVA (tipo / base / cuota)');
    for (const tax of report.tax_breakdown) {
      rows.push(
        fit(
          `${Number(tax.rate).toLocaleString('es-ES')}%  ${formatMoney(tax.taxable_base)}  ${formatMoney(tax.tax_amount)}`,
          width,
        ),
      );
    }
    rows.push(...ticketRow('IVA total', formatMoney(report.tax_total), width));
  }

  rows.push(separator, 'COBROS Y DEVOLUCIONES');
  for (const payment of report.payment_breakdown) {
    rows.push(
      ...ticketRow(paymentLabel(payment.method), formatMoney(payment.collected_total), width),
    );
    if (Number(payment.refunded_total) > 0) {
      rows.push(
        ...ticketRow(
          `Devuelto ${paymentLabel(payment.method)}`,
          `− ${formatMoney(payment.refunded_total)}`,
          width,
        ),
      );
    }
  }
  if (Number(report.returns_total) > 0) {
    rows.push(
      ...ticketRow(
        `Devoluciones (${report.returns_count})`,
        `− ${formatMoney(report.returns_total)}`,
        width,
      ),
    );
  }
  rows.push(
    ...ticketRow(
      'EFECTIVO ESPERADO',
      formatMoney(
        report.payment_breakdown.find((payment) => payment.method === 'CASH')?.net_total ?? '0',
      ),
      width,
    ),
  );

  if (report.terminal_breakdown.length > 0) {
    rows.push(separator, 'POR TERMINAL');
    for (const terminal of report.terminal_breakdown) {
      rows.push(
        ...ticketRow(
          `${terminal.terminal_name} (${terminal.sales_count})`,
          formatMoney(terminal.gross_total),
          width,
        ),
      );
    }
  }
  if (report.cashier_breakdown.length > 0) {
    rows.push(separator, 'POR CAJERO');
    for (const cashier of report.cashier_breakdown) {
      rows.push(
        ...ticketRow(
          `${cashier.cashier_name} (${cashier.sales_count})`,
          formatMoney(cashier.gross_total),
          width,
        ),
      );
    }
  }
  return rows;
}

function render(lines: string[], profile: TicketPrintProfile): string {
  const width = printableCharacters(profile);
  return lines.map((line) => fit(line, width)).join('\n');
}

/** El X es una consulta de control: se calcula de nuevo cada vez, no
 * sustituye una Z y se marca expresamente como no fiscal. */
export function renderXReportTicket(
  report: XReportPreview,
  generatedAtLabel: string,
  profile: TicketPrintProfile,
): string {
  const width = printableCharacters(profile);
  return render(
    [
      centered('RESUMEN X — NO FISCAL', width),
      centered(report.warehouse_name, width),
      `Jornada: ${report.business_date}`,
      `Generado: ${generatedAtLabel}`,
      '-'.repeat(width),
      ...totalsRows(report, width),
    ],
    profile,
  );
}

/** Convierte exclusivamente el snapshot guardado en un recibo térmico. No
 * consulta ventas: una reimpresión conserva el documento emitido al cierre. */
export function renderZReportTicket(
  report: ZReport,
  closedAtLabel: string,
  profile: TicketPrintProfile,
  options: { reprint?: boolean } = {},
): string {
  const width = printableCharacters(profile);
  return render(
    [
      centered(report.store_name || 'CIERRE DE CAJA', width),
      ...(report.store_tax_id ? [centered(report.store_tax_id, width)] : []),
      ...(report.store_address ? [centered(report.store_address, width)] : []),
      '-'.repeat(width),
      centered(`CIERRE Z DEFINITIVO Nº ${report.number}`, width),
      ...(options.reprint ? [centered('REIMPRESIÓN', width)] : []),
      `Jornada: ${report.business_date}`,
      `Cerrado: ${closedAtLabel}`,
      `Almacén: ${report.warehouse_name}`,
      ...(report.closed_by_name ? [`Cajero cierre: ${report.closed_by_name}`] : []),
      '-'.repeat(width),
      ...totalsRows(report, width),
    ],
    profile,
  );
}
