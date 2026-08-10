import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  TAX_DISPLAY_LABELS,
  ticketTaxDisplaySchema,
  type TemplateFields,
  type TicketTaxDisplay,
} from '@/features/tickets/api';
import { renderTicketPreview } from '@/features/tickets/ticketPreview';

const fieldsSchema = z.object({
  name: z.string().max(100).optional(),
  width_mm: z.enum(['58', '80']),
  header_text: z.string().max(2000).optional(),
  footer_text: z.string().max(2000).optional(),
  tax_display: ticketTaxDisplaySchema,
  show_line_discounts: z.boolean(),
});

type TemplateFormValues = z.infer<typeof fieldsSchema>;

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
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = useForm<TemplateFormValues>({
    resolver: zodResolver(fieldsSchema),
    defaultValues: {
      width_mm: defaults ? (String(defaults.width_mm) as '58' | '80') : '80',
      header_text: defaults?.header_text ?? '',
      footer_text: defaults?.footer_text ?? '',
      tax_display: defaults?.tax_display ?? 'BREAKDOWN',
      show_line_discounts: defaults?.show_line_discounts ?? false,
    },
  });

  const preview = renderTicketPreview({
    width_mm: Number(watch('width_mm')) as 58 | 80,
    header_text: watch('header_text') ?? '',
    footer_text: watch('footer_text') ?? '',
    tax_display: watch('tax_display'),
    show_line_discounts: watch('show_line_discounts'),
    prices_include_tax: pricesIncludeTax,
  });

  const submit = handleSubmit((values) => {
    if (mode === 'create' && !values.name?.trim()) {
      setError('name', { message: 'Introduce un nombre.' });
      return;
    }
    onSubmit({
      ...(mode === 'create' ? { name: values.name!.trim() } : {}),
      width_mm: Number(values.width_mm) as 58 | 80,
      header_text: values.header_text ?? '',
      footer_text: values.footer_text ?? '',
      tax_display: values.tax_display,
      show_line_discounts: values.show_line_discounts,
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

          <label className="text-sm text-slate-600 sm:col-span-2">
            Ancho del papel
            <select
              className="mt-1 w-full max-w-xs rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('width_mm')}
            >
              <option value="58">58 mm</option>
              <option value="80">80 mm</option>
            </select>
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
        </div>

        <div className="lg:w-[26rem] lg:shrink-0">
          <p className="mb-1 text-xs font-semibold uppercase text-slate-500">
            Vista previa (con datos de ejemplo)
          </p>
          <pre className="overflow-x-auto rounded border border-dashed border-slate-300 bg-slate-50 p-4 font-mono text-sm leading-relaxed text-slate-700">
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
