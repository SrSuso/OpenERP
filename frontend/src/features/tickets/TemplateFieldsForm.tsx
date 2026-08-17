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
  ticketTaxDisplaySchema,
  type TemplateFields,
  type TicketTaxDisplay,
} from '@/features/tickets/api';
import { useBusinessTimezone } from '@/features/settings/useShopSettings';
import { ticketPreviewStyle, ticketPrintStyle } from '@/features/tickets/printProfile';
import { renderTicketPreview } from '@/features/tickets/ticketPreview';

const fieldsSchema = z.object({
  name: z.string().max(100).optional(),
  printable_width_mm: z.coerce.number().int().min(25).max(80),
  font_family: ticketFontFamilySchema,
  font_size_px: z.coerce.number().int().min(6).max(16),
  line_height_px: z.coerce.number().int().min(8).max(24),
  font_weight: ticketFontWeightSchema,
  margin_top_mm: z.coerce.number().int().min(0).max(20),
  margin_bottom_mm: z.coerce.number().int().min(0).max(20),
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
});

type TemplateFormValues = z.infer<typeof fieldsSchema>;

function previewNumber(value: unknown, fallback: number, minimum = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= minimum ? numeric : fallback;
}

interface TemplateFieldsFormProps {
  mode: 'create' | 'revise';
  defaults?: TemplateFields;
  onSubmit: (payload: TemplateFields & { name?: string }) => void;
  onCancel: () => void;
  isPending: boolean;
  submitError: string | null;
  /** Ajuste de tienda (Precios → "El PVP ya incluye el IVA"), no de la
   * plantilla — sólo lo necesita la vista previa, para calcular las bases
   * igual que lo hará el backend al imprimir de verdad. */
  pricesIncludeTax: boolean;
}

/** Alta de una plantilla (nueva familia, con nombre) o revisión de la
 * activa (mismos campos salvo el nombre, que no cambia — ver
 * backend/app/tickets/schemas.py's `TicketTemplateRevise`). */
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
      printable_width_mm: defaults?.printable_width_mm ?? 72,
      font_family: defaults?.font_family ?? 'COURIER_NEW',
      font_size_px: defaults?.font_size_px ?? 9,
      line_height_px: defaults?.line_height_px ?? 12,
      font_weight: defaults?.font_weight ?? 'NORMAL',
      margin_top_mm: defaults?.margin_top_mm ?? 0,
      margin_bottom_mm: defaults?.margin_bottom_mm ?? 0,
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
  const printProfile = {
    printable_width_mm: previewNumber(watch('printable_width_mm'), 72, 25),
    font_family: watch('font_family') ?? 'COURIER_NEW',
    font_size_px: previewNumber(watch('font_size_px'), 9, 6),
    line_height_px: previewNumber(watch('line_height_px'), 12, 8),
    font_weight: watch('font_weight') ?? 'NORMAL',
    margin_top_mm: previewNumber(watch('margin_top_mm'), 0),
    margin_bottom_mm: previewNumber(watch('margin_bottom_mm'), 0),
  };

  const preview = renderTicketPreview({
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

  const submit = handleSubmit((values) => {
    if (mode === 'create' && !values.name?.trim()) {
      setError('name', { message: 'Introduce un nombre.' });
      return;
    }
    onSubmit({
      ...(mode === 'create' ? { name: values.name!.trim() } : {}),
      printable_width_mm: values.printable_width_mm,
      font_family: values.font_family,
      font_size_px: values.font_size_px,
      line_height_px: values.line_height_px,
      font_weight: values.font_weight,
      margin_top_mm: values.margin_top_mm,
      margin_bottom_mm: values.margin_bottom_mm,
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
        {mode === 'create' ? 'Nueva plantilla' : 'Revisar plantilla activa'}
      </h3>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          {mode === 'create' && (
            <label className="text-sm text-slate-600 sm:col-span-2">
              Nombre
              <input
                type="text"
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                {...register('name')}
              />
              {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>}
            </label>
          )}

          <label className="text-sm text-slate-600">
            Ancho imprimible (mm)
            <input
              type="number"
              min="25"
              max="80"
              className="mt-1 block w-28 rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('printable_width_mm')}
            />
            {errors.printable_width_mm && (
              <p className="mt-1 text-sm text-red-600">{errors.printable_width_mm.message}</p>
            )}
          </label>

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
            Vista previa (con datos de ejemplo)
          </p>
          <pre
            className="overflow-x-auto rounded border border-dashed border-slate-300 bg-slate-50 p-4 text-slate-700"
            style={{ ...ticketPrintStyle(printProfile), ...ticketPreviewStyle(printProfile) }}
          >
            {preview}
          </pre>
        </div>
      </div>

      {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? 'Guardando…' : mode === 'create' ? 'Crear' : 'Guardar nueva versión'}
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
