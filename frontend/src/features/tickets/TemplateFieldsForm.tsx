import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { type TemplateFields } from '@/features/tickets/api';
import { renderTicketPreview } from '@/features/tickets/ticketPreview';

const fieldsSchema = z.object({
  name: z.string().max(100).optional(),
  width_mm: z.enum(['58', '80']),
  header_text: z.string().max(2000).optional(),
  footer_text: z.string().max(2000).optional(),
  show_tax_breakdown: z.boolean(),
});

type TemplateFormValues = z.infer<typeof fieldsSchema>;

interface TemplateFieldsFormProps {
  mode: 'create' | 'revise';
  defaults?: TemplateFields;
  onSubmit: (payload: TemplateFields & { name?: string }) => void;
  onCancel: () => void;
  isPending: boolean;
  submitError: string | null;
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
      show_tax_breakdown: defaults?.show_tax_breakdown ?? true,
    },
  });

  const preview = renderTicketPreview({
    width_mm: Number(watch('width_mm')) as 58 | 80,
    header_text: watch('header_text') ?? '',
    footer_text: watch('footer_text') ?? '',
    show_tax_breakdown: watch('show_tax_breakdown'),
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
      show_tax_breakdown: values.show_tax_breakdown,
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

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          {mode === 'create' && (
            <label className="text-sm text-slate-600">
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
            Ancho del papel
            <select
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('width_mm')}
            >
              <option value="58">58 mm</option>
              <option value="80">80 mm</option>
            </select>
          </label>

          <label className="text-sm text-slate-600 sm:col-span-2">
            Cabecera
            <textarea
              rows={3}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('header_text')}
            />
          </label>

          <label className="text-sm text-slate-600 sm:col-span-2">
            Pie
            <textarea
              rows={3}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('footer_text')}
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-2">
            <input type="checkbox" {...register('show_tax_breakdown')} />
            Mostrar desglose de impuestos
          </label>
        </div>

        <div className="lg:w-64 lg:shrink-0">
          <p className="mb-1 text-xs font-semibold uppercase text-slate-500">
            Vista previa (con datos de ejemplo)
          </p>
          <pre className="overflow-x-auto rounded border border-dashed border-slate-300 bg-slate-50 p-3 font-mono text-xs leading-tight text-slate-700">
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
