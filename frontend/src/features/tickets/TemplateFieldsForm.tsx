import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  DATE_FORMATS,
  TICKET_FONT_FAMILY_LABELS,
  TICKET_FONT_WEIGHT_LABELS,
  TAX_DISPLAY_LABELS,
  ticketFontFamilySchema,
  ticketFontWeightSchema,
  ticketLayoutModeSchema,
  ticketTaxDisplaySchema,
  type TemplateFields,
  type TicketTemplate,
  type TicketTaxDisplay,
} from '@/features/tickets/api';
import { useBusinessTimezone } from '@/features/settings/useShopSettings';
import {
  TicketLayoutTemplateError,
  renderTicketLayoutTemplate,
  ticketLayoutPreviewContext,
} from '@/features/tickets/layoutTemplate';
import {
  THERMAL_PAPER_WIDTH_MM,
  printableWidthFromMargins,
  ticketPreviewStyle,
  ticketPrintStyle,
} from '@/features/tickets/printProfile';
import { renderTicketPreview } from '@/features/tickets/ticketPreview';

const fieldsSchema = z
  .object({
    name: z.string().max(100).optional(),
    margin_left_mm: z.coerce.number().int().min(0).max(55),
    margin_right_mm: z.coerce.number().int().min(0).max(55),
    font_family: ticketFontFamilySchema,
    font_size_px: z.coerce.number().int().min(6).max(16),
    line_height_px: z.coerce.number().int().min(8).max(24),
    font_weight: ticketFontWeightSchema,
    margin_top_mm: z.coerce.number().int().min(0).max(20),
    margin_bottom_mm: z.coerce.number().int().min(0).max(20),
    layout_template: z.string().max(8000),
    layout_mode: ticketLayoutModeSchema,
    header_text: z.string().max(2000).optional(),
    footer_text: z.string().max(2000).optional(),
    tax_display: ticketTaxDisplaySchema,
    show_line_discounts: z.boolean(),
    // Lo que antes se rellenaba en Configuración y salía impreso desde allí:
    // ahora vive aquí, que es donde se edita el ticket.
    store_name: z.string().max(500).optional(),
    store_tax_id: z.string().max(500).optional(),
    store_address: z.string().max(1000).optional(),
    store_phone: z.string().max(200).optional(),
    sale_number_prefix: z.string().max(50).optional(),
    date_format: z.string().max(50),
    show_unit_price: z.boolean(),
    show_cashier: z.boolean(),
    label_total: z.string().max(50).optional(),
    label_change: z.string().max(50).optional(),
    label_cash: z.string().max(50).optional(),
    label_card: z.string().max(50).optional(),
    label_other: z.string().max(50).optional(),
    label_discount: z.string().max(50).optional(),
    tax_note: z.string().max(200).optional(),
  })
  .superRefine((values, context) => {
    const printableWidth = printableWidthFromMargins(values.margin_left_mm, values.margin_right_mm);
    if (printableWidth < 25) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['margin_right_mm'],
        message: 'Los márgenes deben dejar al menos 25 mm para el texto.',
      });
    }
    if (values.layout_mode === 'CUSTOM' && !values.layout_template.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['layout_template'],
        message: 'Escribe el diseño de la plantilla con variables.',
      });
    }
  });

type TemplateFormValues = z.infer<typeof fieldsSchema>;

function previewNumber(value: unknown, fallback: number, minimum = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= minimum ? numeric : fallback;
}

interface TemplateFieldsFormProps {
  mode: 'create' | 'edit';
  defaults?: TicketTemplate;
  onSubmit: (payload: TemplateFields & { name: string }) => void;
  onCancel: () => void;
  isPending: boolean;
  submitError: string | null;
  /** Ajuste de tienda (Precios → "El PVP ya incluye el IVA"), no de la
   * plantilla — sólo lo necesita la vista previa, para calcular las bases
   * igual que lo hará el backend al imprimir de verdad. */
  pricesIncludeTax: boolean;
}

/** Alta o edición directa de una plantilla guardada. */
export function TemplateFieldsForm({
  mode,
  defaults,
  onSubmit,
  onCancel,
  isPending,
  submitError,
  pricesIncludeTax,
}: TemplateFieldsFormProps) {
  const businessTimezone = useBusinessTimezone();
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = useForm<TemplateFormValues>({
    resolver: zodResolver(fieldsSchema),
    defaultValues: {
      name: defaults?.name ?? '',
      margin_left_mm: defaults?.margin_left_mm ?? 4,
      margin_right_mm: defaults?.margin_right_mm ?? 4,
      font_family: defaults?.font_family ?? 'COURIER_NEW',
      font_size_px: defaults?.font_size_px ?? 9,
      line_height_px: defaults?.line_height_px ?? 12,
      font_weight: defaults?.font_weight ?? 'NORMAL',
      margin_top_mm: defaults?.margin_top_mm ?? 0,
      margin_bottom_mm: defaults?.margin_bottom_mm ?? 0,
      layout_template: defaults?.layout_template ?? '',
      layout_mode: defaults?.layout_mode ?? 'STANDARD',
      header_text: defaults?.header_text ?? '',
      footer_text: defaults?.footer_text ?? '',
      tax_display: defaults?.tax_display ?? 'BREAKDOWN',
      show_line_discounts: defaults?.show_line_discounts ?? false,
      store_name: defaults?.store_name ?? '',
      store_tax_id: defaults?.store_tax_id ?? '',
      store_address: defaults?.store_address ?? '',
      store_phone: defaults?.store_phone ?? '',
      sale_number_prefix: defaults?.sale_number_prefix ?? 'Venta #',
      date_format: defaults?.date_format ?? '%d/%m/%Y %H:%M',
      show_unit_price: defaults?.show_unit_price ?? true,
      show_cashier: defaults?.show_cashier ?? false,
      label_total: defaults?.label_total ?? 'TOTAL',
      label_change: defaults?.label_change ?? 'Cambio',
      label_cash: defaults?.label_cash ?? 'Efectivo',
      label_card: defaults?.label_card ?? 'Tarjeta',
      label_other: defaults?.label_other ?? 'Otros',
      label_discount: defaults?.label_discount ?? 'Dto.',
      tax_note: defaults?.tax_note ?? 'IVA incluido',
    },
  });

  // A number input is temporarily empty while it is being replaced. Keep
  // preview calculation safe for that short editing state; Zod still blocks
  // an invalid value when the form is submitted.
  const marginLeftMm = previewNumber(watch('margin_left_mm'), 4);
  const marginRightMm = previewNumber(watch('margin_right_mm'), 4);
  const printableWidthMm = Math.max(25, printableWidthFromMargins(marginLeftMm, marginRightMm));
  const printProfile = {
    printable_width_mm: printableWidthMm,
    margin_left_mm: marginLeftMm,
    margin_right_mm: marginRightMm,
    font_family: watch('font_family') ?? 'COURIER_NEW',
    font_size_px: previewNumber(watch('font_size_px'), 9, 6),
    line_height_px: previewNumber(watch('line_height_px'), 12, 8),
    font_weight: watch('font_weight') ?? 'NORMAL',
    margin_top_mm: previewNumber(watch('margin_top_mm'), 0),
    margin_bottom_mm: previewNumber(watch('margin_bottom_mm'), 0),
  };

  let preview = renderTicketPreview({
    printable_width_mm: printProfile.printable_width_mm,
    font_size_px: printProfile.font_size_px,
    font_weight: printProfile.font_weight,
    header_text: watch('header_text') ?? '',
    footer_text: watch('footer_text') ?? '',
    tax_display: watch('tax_display'),
    show_line_discounts: watch('show_line_discounts'),
    prices_include_tax: pricesIncludeTax,
    store_name: watch('store_name') ?? '',
    store_tax_id: watch('store_tax_id') ?? '',
    store_address: watch('store_address') ?? '',
    store_phone: watch('store_phone') ?? '',
    sale_number_prefix: watch('sale_number_prefix') ?? '',
    show_unit_price: watch('show_unit_price'),
    label_total: watch('label_total') ?? '',
    label_cash: watch('label_cash') ?? '',
    label_change: watch('label_change') ?? '',
    label_discount: watch('label_discount') ?? '',
    tax_note: watch('tax_note') ?? '',
    business_timezone: businessTimezone,
  });
  let layoutPreviewError: string | null = null;
  const layoutTemplate = watch('layout_template') ?? '';
  const layoutMode = watch('layout_mode') ?? 'STANDARD';
  if (layoutMode === 'CUSTOM' && layoutTemplate.trim()) {
    try {
      preview = renderTicketLayoutTemplate(
        layoutTemplate,
        ticketLayoutPreviewContext(
          {
            store_name: watch('store_name') ?? '',
            store_tax_id: watch('store_tax_id') ?? '',
            store_address: watch('store_address') ?? '',
            store_phone: watch('store_phone') ?? '',
            header_text: watch('header_text') ?? '',
            footer_text: watch('footer_text') ?? '',
            label_total: watch('label_total') ?? '',
            label_change: watch('label_change') ?? '',
            label_cash: watch('label_cash') ?? '',
            label_card: watch('label_card') ?? '',
            label_other: watch('label_other') ?? '',
            tax_note: watch('tax_note') ?? '',
          },
          Math.max(16, Math.floor(printProfile.printable_width_mm / 1.48)),
        ),
        Math.max(16, Math.floor(printProfile.printable_width_mm / 1.48)),
      );
    } catch (error) {
      layoutPreviewError =
        error instanceof TicketLayoutTemplateError
          ? error.message
          : 'No se ha podido generar la vista previa del diseño.';
    }
  }

  const submit = handleSubmit((values) => {
    if (!values.name?.trim()) {
      setError('name', { message: 'Introduce un nombre.' });
      return;
    }
    onSubmit({
      name: values.name.trim(),
      printable_width_mm: printableWidthFromMargins(values.margin_left_mm, values.margin_right_mm),
      margin_left_mm: values.margin_left_mm,
      margin_right_mm: values.margin_right_mm,
      font_family: values.font_family,
      font_size_px: values.font_size_px,
      line_height_px: values.line_height_px,
      font_weight: values.font_weight,
      margin_top_mm: values.margin_top_mm,
      margin_bottom_mm: values.margin_bottom_mm,
      layout_template: values.layout_template ?? '',
      layout_mode: values.layout_mode,
      header_text: values.header_text ?? '',
      footer_text: values.footer_text ?? '',
      tax_display: values.tax_display,
      show_line_discounts: values.show_line_discounts,
      store_name: values.store_name ?? '',
      store_tax_id: values.store_tax_id ?? '',
      store_address: values.store_address ?? '',
      store_phone: values.store_phone ?? '',
      sale_number_prefix: values.sale_number_prefix ?? '',
      date_format: values.date_format,
      show_unit_price: values.show_unit_price,
      show_cashier: values.show_cashier,
      label_total: values.label_total ?? '',
      label_change: values.label_change ?? '',
      label_cash: values.label_cash ?? '',
      label_card: values.label_card ?? '',
      label_other: values.label_other ?? '',
      label_discount: values.label_discount ?? '',
      tax_note: values.tax_note ?? '',
    });
  });

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h3 className="mb-3 text-sm font-semibold text-slate-700">
        {mode === 'create' ? 'Nueva plantilla' : 'Editar plantilla'}
      </h3>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-600 sm:col-span-2">
            Nombre
            <input
              type="text"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('name')}
            />
            {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>}
          </label>

          <div className="text-sm text-slate-600 sm:col-span-2">
            <label htmlFor="ticket-layout-mode">Tipo de editor</label>
            <select
              id="ticket-layout-mode"
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('layout_mode')}
            >
              <option value="STANDARD">Estándar — configurar mediante campos</option>
              <option value="CUSTOM">Plantilla con variables — editor tipo LaTeX sencillo</option>
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              Puedes cambiar de modo sin perder el texto de la plantilla personalizada.
            </span>
          </div>

          <fieldset className="grid gap-3 rounded border border-slate-200 p-3 sm:col-span-2 sm:grid-cols-3">
            <legend className="px-1 text-sm font-medium text-slate-600">Papel y área útil</legend>
            <label className="text-sm text-slate-600">
              Margen izquierdo (mm)
              <input
                type="number"
                min="0"
                max="55"
                className="mt-1 block w-28 rounded border border-slate-300 px-3 py-2 text-sm"
                {...register('margin_left_mm')}
              />
              {errors.margin_left_mm && (
                <span className="mt-1 block text-sm text-red-600">
                  {errors.margin_left_mm.message}
                </span>
              )}
            </label>
            <label className="text-sm text-slate-600">
              Ancho útil calculado (mm)
              <output className="mt-1 block w-28 rounded border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700">
                {printableWidthMm}
              </output>
            </label>
            <label className="text-sm text-slate-600">
              Margen derecho (mm)
              <input
                type="number"
                min="0"
                max="55"
                className="mt-1 block w-28 rounded border border-slate-300 px-3 py-2 text-sm"
                {...register('margin_right_mm')}
              />
              {errors.margin_right_mm && (
                <span className="mt-1 block text-sm text-red-600">
                  {errors.margin_right_mm.message}
                </span>
              )}
            </label>
            <p className="text-xs text-slate-500 sm:col-span-3">
              Como en LibreOffice, la bobina permanece en 80 mm y el ancho útil se calcula como 80
              menos los dos márgenes. Los márgenes mueven y estrechan el área de texto; nunca
              cambian el tamaño de letra.
            </p>
          </fieldset>

          <label className="text-sm text-slate-600">
            Tipo de letra
            <select
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('font_family')}
            >
              {ticketFontFamilySchema.options.map((font) => (
                <option key={font} value={font}>
                  {TICKET_FONT_FAMILY_LABELS[font]}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-600">
            Tamaño de letra (px)
            <input
              type="number"
              min="6"
              max="16"
              className="mt-1 block w-28 rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('font_size_px')}
            />
            {errors.font_size_px && (
              <p className="mt-1 text-sm text-red-600">{errors.font_size_px.message}</p>
            )}
          </label>

          <label className="text-sm text-slate-600">
            Interlineado (px)
            <input
              type="number"
              min="8"
              max="24"
              className="mt-1 block w-28 rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('line_height_px')}
            />
            {errors.line_height_px && (
              <p className="mt-1 text-sm text-red-600">{errors.line_height_px.message}</p>
            )}
          </label>

          <label className="text-sm text-slate-600">
            Grosor de letra
            <select
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('font_weight')}
            >
              {ticketFontWeightSchema.options.map((weight) => (
                <option key={weight} value={weight}>
                  {TICKET_FONT_WEIGHT_LABELS[weight]}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-600">
            Margen superior (mm)
            <input
              type="number"
              min="0"
              max="20"
              className="mt-1 block w-28 rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('margin_top_mm')}
            />
          </label>

          <label className="text-sm text-slate-600">
            Margen inferior (mm)
            <input
              type="number"
              min="0"
              max="20"
              className="mt-1 block w-28 rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('margin_bottom_mm')}
            />
          </label>

          <p className="text-xs text-slate-500 sm:col-span-2">
            El largo del ticket es automático: una impresora térmica corta al terminar el contenido.
            Fijar una altura podría cortar líneas o dejar papel en blanco.
          </p>

          <div className="rounded border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 sm:col-span-2">
            <p className="font-semibold">Configuración necesaria al imprimir</p>
            <p className="mt-1">
              En el controlador selecciona papel o bobina de 80 mm, escala 100 % (tamaño real),
              márgenes ninguno y cabeceras y pies desactivados. OpenERP controla el ancho del
              contenido, los márgenes y la tipografía; la impresora controla el largo continuo y el
              corte. Un destino A4 como «Microsoft Print to PDF» seguirá mostrando una hoja A4.
            </p>
          </div>

          {layoutMode === 'CUSTOM' && (
            <div className="sm:col-span-2">
              <label className="text-sm text-slate-600">
                Diseño del ticket (plantilla segura)
                <textarea
                  rows={14}
                  spellCheck={false}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm"
                  placeholder={
                    '{{ store.name | center }}\n{{ separator }}\n{% for line in sale.lines %}\n{{ line.name | left:32 }}{{ line.total | right:16 }}\n{% endfor %}\n{{ labels.total | left:32 }}{{ totals.total | right:16 }}'
                  }
                  {...register('layout_template')}
                />
              </label>
              {errors.layout_template && (
                <p className="mt-1 text-sm text-red-600">{errors.layout_template.message}</p>
              )}
              <p className="mt-1 text-xs text-slate-500">
                Este diseño controla todo el contenido y se valida al guardar. Es una sintaxis
                sencilla inspirada en plantillas, no ejecuta LaTeX, HTML ni código.
              </p>
              <details className="mt-2 rounded border border-slate-200 px-3 py-2 text-xs text-slate-600">
                <summary className="cursor-pointer font-medium">
                  Variables y formato disponibles
                </summary>
                <p className="mt-2">
                  Tienda: <code>{'{{ store.name }}'}</code>, <code>{'{{ store.tax_id }}'}</code>,{' '}
                  <code>{'{{ store.address }}'}</code>, <code>{'{{ store.phone }}'}</code>. Venta:{' '}
                  <code>{'{{ sale.number }}'}</code>, <code>{'{{ sale.date }}'}</code>,{' '}
                  <code>{'{{ sale.cashier }}'}</code>. Totales: <code>{'{{ totals.total }}'}</code>,{' '}
                  <code>{'{{ totals.tax }}'}</code>, <code>{'{{ totals.change }}'}</code> y{' '}
                  <code>{'{{ separator }}'}</code>.
                </p>
                <p className="mt-1">
                  Alinea con <code>{'{{ valor | left:32 }}'}</code>,{' '}
                  <code>{'{{ valor | right:16 }}'}</code> o <code>{'{{ valor | center }}'}</code>.
                </p>
                <pre className="mt-2 overflow-hidden rounded bg-slate-100 p-2 text-[11px] leading-4 text-slate-700">{`{% for line in sale.lines %}
{{ line.name | left:32 }}{{ line.total | right:16 }}
{{ line.quantity }} x {{ line.unit_price }}
{% endfor %}

{% for payment in sale.payments %}
{{ payment.label | left:32 }}{{ payment.amount | right:16 }}
{% endfor %}`}</pre>
                <p className="mt-1">
                  También existe <code>tax</code> en <code>{'{% for tax in sale.taxes %}'}</code>.
                </p>
              </details>
            </div>
          )}

          {/* Los datos de la tienda: aquí y no en Configuración, para que el
              ticket se edite en un solo sitio. */}
          <label className="text-sm text-slate-600">
            Nombre de la tienda
            <input
              type="text"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('store_name')}
            />
          </label>

          <label className="text-sm text-slate-600">
            NIF / CIF
            <input
              type="text"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('store_tax_id')}
            />
          </label>

          <label className="text-sm text-slate-600">
            Dirección
            <textarea
              rows={2}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('store_address')}
            />
          </label>

          <label className="text-sm text-slate-600">
            Teléfono
            <input
              type="text"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('store_phone')}
            />
          </label>

          <label className="text-sm text-slate-600 sm:col-span-2">
            Cabecera
            <textarea
              rows={8}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('header_text')}
            />
          </label>

          <label className="text-sm text-slate-600 sm:col-span-2">
            Pie
            <textarea
              rows={8}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('footer_text')}
            />
          </label>

          {/* La ayuda va fuera del <label> a propósito: dentro pasaría a
              formar parte del nombre accesible del desplegable. */}
          <div className="text-sm text-slate-600 sm:col-span-2">
            <label>
              IVA en el ticket
              <select
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                {...register('tax_display')}
              >
                {ticketTaxDisplaySchema.options.map((option: TicketTaxDisplay) => (
                  <option key={option} value={option}>
                    {TAX_DISPLAY_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
            <span className="mt-1 block text-xs text-slate-400">
              Una factura simplificada necesita al menos la nota «IVA incluido». El desglose añade
              una tabla con la base y la cuota de cada tipo.
            </span>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-2">
            <input type="checkbox" {...register('show_line_discounts')} />
            Mostrar el descuento aplicado bajo cada línea con descuento
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-2">
            <input type="checkbox" {...register('show_unit_price')} />
            Mostrar la línea «2 x 1,65 €» bajo cada producto
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-2">
            <input type="checkbox" {...register('show_cashier')} />
            Mostrar quién ha atendido
          </label>

          <label className="text-sm text-slate-600">
            Texto antes del número
            <input
              type="text"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('sale_number_prefix')}
            />
          </label>

          <label className="text-sm text-slate-600">
            Formato de la fecha
            <select
              className="mt-1 block w-56 rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('date_format')}
            >
              {DATE_FORMATS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {/* Las palabras que se imprimen: cada tienda las dice a su
              manera, y hay quien las quiere en otro idioma. */}
          <label className="text-sm text-slate-600">
            Palabra para el total
            <input
              type="text"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('label_total')}
            />
          </label>

          <label className="text-sm text-slate-600">
            Palabra para el cambio
            <input
              type="text"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('label_change')}
            />
          </label>

          <label className="text-sm text-slate-600">
            Pago en efectivo
            <input
              type="text"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('label_cash')}
            />
          </label>

          <label className="text-sm text-slate-600">
            Pago con tarjeta
            <input
              type="text"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('label_card')}
            />
          </label>

          <label className="text-sm text-slate-600">
            Otras formas de pago
            <input
              type="text"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('label_other')}
            />
          </label>

          <label className="text-sm text-slate-600">
            Palabra para el descuento
            <input
              type="text"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('label_discount')}
            />
          </label>

          <label className="text-sm text-slate-600 sm:col-span-2">
            Nota del IVA
            <input
              type="text"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('tax_note')}
            />
          </label>
        </div>

        <div className="lg:w-[26rem] lg:shrink-0">
          <p className="mb-1 text-xs font-semibold uppercase text-slate-500">
            Vista previa — papel de 80 mm (datos de ejemplo)
          </p>
          <div
            data-ticket-paper-preview
            className="overflow-hidden rounded border border-slate-300 bg-white shadow-sm"
            style={{ width: `${THERMAL_PAPER_WIDTH_MM}mm`, boxSizing: 'border-box' }}
          >
            <pre
              data-ticket-template-preview
              className="overflow-hidden border-x border-dashed border-sky-300 bg-slate-50/60 p-0 text-slate-700"
              style={{ ...ticketPrintStyle(printProfile), ...ticketPreviewStyle(printProfile) }}
            >
              {preview}
            </pre>
          </div>
          {layoutPreviewError && <p className="mt-2 text-sm text-red-600">{layoutPreviewError}</p>}
        </div>
      </div>

      {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? 'Guardando…' : mode === 'create' ? 'Crear' : 'Guardar cambios'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
