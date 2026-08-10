/** Vista previa de un ticket con datos de ejemplo, para ver el efecto de
 * ancho/cabecera/pie/desglose mientras se edita la plantilla — sin tener
 * que generar un ticket real contra una venta. Réplica deliberadamente
 * simplificada (no económicamente exacta) del formato monoespaciado de
 * backend/app/tickets/render.py's `render_ticket`: incluir la lógica real
 * exigiría construir una `Sale` de mentira sólo para previsualizar. */

import { type TicketTaxDisplay } from '@/features/tickets/api';

const CHARS_PER_WIDTH: Record<58 | 80, number> = { 58: 32, 80: 48 };

function center(text: string, width: number): string {
  const trimmed = text.trim();
  if (trimmed.length >= width) return trimmed.slice(0, width);
  const pad = width - trimmed.length;
  const left = Math.floor(pad / 2);
  return ' '.repeat(left) + trimmed + ' '.repeat(pad - left);
}

function rule(width: number): string {
  return '-'.repeat(width);
}

function twoColumn(left: string, right: string, width: number): string[] {
  if (left.length + 1 + right.length <= width) {
    return [left + ' '.repeat(width - left.length - right.length) + right];
  }
  return [left, ' '.repeat(Math.max(0, width - right.length)) + right];
}

function threeColumn(left: string, middle: string, right: string, width: number): string {
  const remaining = width - left.length;
  const middleWidth = Math.floor(remaining / 2);
  return left + middle.padStart(middleWidth) + right.padStart(remaining - middleWidth);
}

function eur(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} €`;
}

/** Dos líneas de ejemplo con tasas de IVA distintas (10% y 21%) y una con
 * descuento — para que la vista previa muestre algo real cuando se activan
 * "IVA desglosado por tipo" y "descuento por línea", en vez de un único
 * total que no distinguiría nada. */
const SAMPLE_LINES = [
  { name: 'Agua mineral 1.5L', qty: 2, unitPrice: 0.95, taxRate: 10, discountRate: 0 },
  { name: 'Detergente', qty: 1, unitPrice: 3.5, taxRate: 21, discountRate: 10 },
];

export interface TicketPreviewFields {
  width_mm: 58 | 80;
  header_text: string;
  footer_text: string;
  tax_display: TicketTaxDisplay;
  show_line_discounts: boolean;
  /** Ajuste de tienda (Precios), no de la plantilla — la vista previa lo
   * necesita porque cambia si el IVA se extrae del precio o se le suma. */
  prices_include_tax: boolean;
}

export function renderTicketPreview(fields: TicketPreviewFields): string {
  const width = CHARS_PER_WIDTH[fields.width_mm];
  const rows: string[] = [];

  const headerLines = fields.header_text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  headerLines.forEach((line) => rows.push(center(line, width)));
  if (headerLines.length > 0) rows.push(rule(width));

  rows.push('Venta #0001');
  rows.push(new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }));
  rows.push(rule(width));

  let subtotal = 0;
  const netByRate = new Map<number, number>();
  const taxByRate = new Map<number, number>();

  for (const line of SAMPLE_LINES) {
    const subtotalLine = line.qty * line.unitPrice;
    const discountAmount = (subtotalLine * line.discountRate) / 100;
    const remaining = subtotalLine - discountAmount;
    // Mismas dos ramas que backend/app/tickets/render.py's `_line_amounts`.
    const net = fields.prices_include_tax ? remaining / (1 + line.taxRate / 100) : remaining;
    const taxAmount = fields.prices_include_tax ? remaining - net : (net * line.taxRate) / 100;
    netByRate.set(line.taxRate, (netByRate.get(line.taxRate) ?? 0) + net);
    taxByRate.set(line.taxRate, (taxByRate.get(line.taxRate) ?? 0) + taxAmount);
    subtotal += net;

    rows.push(...twoColumn(line.name, eur(net + taxAmount), width));
    rows.push(`${line.qty} x ${eur(line.unitPrice)}`);
    if (fields.show_line_discounts && line.discountRate > 0) {
      rows.push(...twoColumn(`Dto. ${line.discountRate}%`, `-${eur(discountAmount)}`, width));
    }
  }

  const taxTotal = [...taxByRate.values()].reduce((sum, amount) => sum + amount, 0);
  const total = subtotal + taxTotal;

  rows.push(rule(width));
  rows.push(...twoColumn('TOTAL', eur(total), width));
  if (fields.tax_display === 'NOTE') {
    rows.push(center('IVA incluido', width));
  } else if (fields.tax_display === 'BREAKDOWN') {
    rows.push(rule(width));
    rows.push('IVA incluido');
    rows.push(threeColumn('Tipo', 'Base', 'Cuota', width));
    for (const rate of [...netByRate.keys()].sort((a, b) => a - b)) {
      rows.push(
        threeColumn(
          `${rate}%`,
          eur(netByRate.get(rate) ?? 0),
          eur(taxByRate.get(rate) ?? 0),
          width,
        ),
      );
    }
  }
  rows.push(rule(width));

  const tendered = Math.ceil(total);
  rows.push(...twoColumn('Efectivo', eur(tendered), width));
  rows.push(...twoColumn('Cambio', eur(tendered - total), width));

  const footerLines = fields.footer_text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (footerLines.length > 0) {
    rows.push(rule(width));
    footerLines.forEach((line) => rows.push(center(line, width)));
  }

  return rows.join('\n');
}
