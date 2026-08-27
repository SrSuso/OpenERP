/** A small receipt-only template language, mirrored by backend/app/tickets/layout.py.
 * It intentionally has no expressions, HTML, JavaScript or arbitrary helpers. */

type LayoutContext = Record<string, unknown>;

const VARIABLE = /^[a-z_]+(?:\.[a-z_]+)*$/;
const FILTER = /^(left|right|center)(?::([1-9]\d{0,2}))?$/;
const LOOP = /^for\s+(line|payment|tax)\s+in\s+(sale\.lines|sale\.payments|sale\.taxes)$/;
const ALLOWED_VARIABLES = new Set([
  'separator',
  'store.name',
  'store.tax_id',
  'store.address',
  'store.phone',
  'template.header',
  'template.footer',
  'sale.number',
  'sale.date',
  'sale.cashier',
  'totals.subtotal',
  'totals.tax',
  'totals.total',
  'totals.tendered',
  'totals.change',
  'labels.total',
  'labels.change',
  'labels.cash',
  'labels.card',
  'labels.other',
  'labels.tax_note',
  'line.name',
  'line.quantity',
  'line.unit_price',
  'line.total',
  'line.discount',
  'line.tax_rate',
  'payment.label',
  'payment.amount',
  'tax.rate',
  'tax.base',
  'tax.amount',
]);

export class TicketLayoutTemplateError extends Error {}

function readValue(path: string, context: LayoutContext): string {
  let value: unknown = context;
  for (const key of path.split('.')) {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || !(key in value)) {
      throw new TicketLayoutTemplateError(`Variable no disponible: ${path}`);
    }
    value = (value as Record<string, unknown>)[key];
  }
  if (typeof value !== 'string')
    throw new TicketLayoutTemplateError(`Variable no disponible: ${path}`);
  return value;
}

function renderExpression(expression: string, context: LayoutContext, width: number): string {
  const [path, ...filters] = expression.split('|').map((part) => part.trim());
  if (path === undefined || !VARIABLE.test(path) || !ALLOWED_VARIABLES.has(path)) {
    throw new TicketLayoutTemplateError(`Variable no permitida: {{${expression}}}`);
  }
  let value = readValue(path, context);
  for (const filter of filters) {
    const match = FILTER.exec(filter);
    if (match === null) throw new TicketLayoutTemplateError(`Filtro no permitido: ${filter}`);
    const targetWidth = Number(match[2] ?? width);
    if (match[1] === 'left') value = value.slice(0, targetWidth).padEnd(targetWidth);
    if (match[1] === 'right') value = value.slice(-targetWidth).padStart(targetWidth);
    if (match[1] === 'center')
      value = value
        .slice(0, targetWidth)
        .padStart(Math.ceil((targetWidth + value.length) / 2))
        .padEnd(targetWidth);
  }
  return value;
}

function renderValues(source: string, context: LayoutContext, width: number): string {
  return source.replace(/\{\{(.*?)\}\}/gs, (_whole, expression: string) =>
    renderExpression(expression.trim(), context, width),
  );
}

function collectionFor(path: string, context: LayoutContext): Array<Record<string, unknown>> {
  const [root, key] = path.split('.');
  const value = root === undefined ? undefined : context[root];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TicketLayoutTemplateError(`Colección no disponible: ${path}`);
  }
  const collection = key === undefined ? undefined : (value as Record<string, unknown>)[key];
  if (!Array.isArray(collection))
    throw new TicketLayoutTemplateError(`Colección no disponible: ${path}`);
  return collection as Array<Record<string, unknown>>;
}

function fitThermalLines(source: string, width: number): string {
  return source
    .split('\n')
    .flatMap((line) => {
      if (line.length === 0) return [''];
      const rows: string[] = [];
      for (let start = 0; start < line.length; start += width)
        rows.push(line.slice(start, start + width).trimEnd());
      return rows;
    })
    .join('\n');
}

export function renderTicketLayoutTemplate(
  source: string,
  context: LayoutContext,
  width: number,
): string {
  let expanded = source;
  while (expanded.includes('{%')) {
    let renderedLoop = false;
    expanded = expanded.replace(
      /\{%\s*(.*?)\s*%\}([\s\S]*?)\{%\s*endfor\s*%\}/g,
      (_whole, statement: string, body: string) => {
        const match = LOOP.exec(statement.trim());
        if (match === null || body.includes('{%')) {
          throw new TicketLayoutTemplateError('Bloque no permitido o bucle anidado.');
        }
        renderedLoop = true;
        const item = match[1];
        const collection = match[2];
        if (item === undefined || collection === undefined) {
          throw new TicketLayoutTemplateError('Bucle de plantilla no válido.');
        }
        return collectionFor(collection, context)
          .map((value) => renderValues(body, { ...context, [item]: value }, width))
          .join('');
      },
    );
    if (!renderedLoop)
      throw new TicketLayoutTemplateError('Bloque de plantilla sin cerrar o no permitido.');
  }
  if (expanded.includes('%}')) {
    throw new TicketLayoutTemplateError('Etiqueta de plantilla sin cerrar.');
  }
  const rendered = renderValues(expanded, context, width);
  if (rendered.includes('{{') || rendered.includes('}}')) {
    throw new TicketLayoutTemplateError('Etiqueta de plantilla sin cerrar.');
  }
  return fitThermalLines(rendered, width);
}

export interface TicketLayoutPreviewValues {
  store_name: string;
  store_tax_id: string;
  store_address: string;
  store_phone: string;
  header_text: string;
  footer_text: string;
  label_total: string;
  label_change: string;
  label_cash: string;
  label_card: string;
  label_other: string;
  tax_note: string;
}

export function ticketLayoutPreviewContext(
  values: TicketLayoutPreviewValues,
  width: number,
): LayoutContext {
  return {
    separator: '-'.repeat(width),
    store: {
      name: values.store_name,
      tax_id: values.store_tax_id,
      address: values.store_address,
      phone: values.store_phone,
    },
    template: { header: values.header_text, footer: values.footer_text },
    sale: {
      number: '0001',
      date: '28/08/2026 12:00',
      cashier: 'María',
      lines: [
        {
          name: 'Agua mineral 1.5L',
          quantity: '2',
          unit_price: '0.95',
          total: '1.90',
          discount: '0.00',
          tax_rate: '10',
        },
      ],
      payments: [{ label: values.label_cash, amount: '2.00' }],
      taxes: [{ rate: '10', base: '1.73', amount: '0.17' }],
    },
    totals: { subtotal: '1.73', tax: '0.17', total: '1.90', tendered: '2.00', change: '0.10' },
    labels: {
      total: values.label_total,
      change: values.label_change,
      cash: values.label_cash,
      card: values.label_card,
      other: values.label_other,
      tax_note: values.tax_note,
    },
  };
}
