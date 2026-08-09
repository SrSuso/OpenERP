/** Vista previa de un ticket con datos de ejemplo, para ver el efecto de
 * ancho/cabecera/pie/desglose mientras se edita la plantilla — sin tener
 * que generar un ticket real contra una venta. Réplica deliberadamente
 * simplificada (no económicamente exacta) del formato monoespaciado de
 * backend/app/tickets/render.py's `render_ticket`: incluir la lógica real
 * exigiría construir una `Sale` de mentira sólo para previsualizar. */

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

const SAMPLE_LINES = [
  { name: 'Agua mineral 1.5L', qty: '2', unitPrice: '0,95 €', total: '1,90 €' },
  { name: 'Pan de pueblo', qty: '1', unitPrice: '2,30 €', total: '2,30 €' },
];

export interface TicketPreviewFields {
  width_mm: 58 | 80;
  header_text: string;
  footer_text: string;
  show_tax_breakdown: boolean;
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

  for (const line of SAMPLE_LINES) {
    rows.push(...twoColumn(line.name, line.total, width));
    rows.push(`${line.qty} x ${line.unitPrice}`);
  }

  rows.push(rule(width));
  if (fields.show_tax_breakdown) {
    rows.push(...twoColumn('Base imponible', '3,47 €', width));
    rows.push(...twoColumn('Impuestos', '0,73 €', width));
  }
  rows.push(...twoColumn('TOTAL', '4,20 €', width));
  rows.push(rule(width));
  rows.push(...twoColumn('Efectivo', '5,00 €', width));
  rows.push(...twoColumn('Cambio', '0,80 €', width));

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
