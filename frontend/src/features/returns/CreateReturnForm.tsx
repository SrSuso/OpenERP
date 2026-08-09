import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { type Sale, type ReturnLineInput } from '@/features/returns/api';
import { decimalString } from '@/lib/decimal';
import { formatQuantity } from '@/lib/format';

function remainingPackages(line: Sale['lines'][number]): number {
  return (
    (Number(line.quantity_base) - Number(line.quantity_returned)) / Number(line.package_factor)
  );
}

const addLineSchema = z.object({
  sale_line_id: z.string().min(1, 'Elige una línea.'),
  quantity_packages: decimalString({ min: 0.000001 }),
  economic: z.boolean(),
  physical: z.boolean(),
  lot_number: z.string().max(100).optional(),
});

type AddLineFormValues = z.infer<typeof addLineSchema>;

interface StagedLine extends ReturnLineInput {
  label: string;
}

interface CreateReturnFormProps {
  sale: Sale;
  onSubmit: (payload: { notes: string; lines: ReturnLineInput[] }) => void;
  isPending: boolean;
  submitError: string | null;
}

/** Devolución contra una venta `COMPLETED` — cada línea puede reembolsar
 * dinero, reponer stock, o ambos (rule 9), así que se apilan localmente
 * antes de mandarlas todas juntas, igual que una recepción de mercancía. */
export function CreateReturnForm({
  sale,
  onSubmit,
  isPending,
  submitError,
}: CreateReturnFormProps) {
  const [notes, setNotes] = useState('');
  const [stagedLines, setStagedLines] = useState<StagedLine[]>([]);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<AddLineFormValues>({
    resolver: zodResolver(addLineSchema),
    defaultValues: { economic: true, physical: true },
  });

  const stagedIds = new Set(stagedLines.map((line) => line.sale_line_id));
  const pendingLines = sale.lines.filter(
    (line) => !stagedIds.has(line.id) && remainingPackages(line) > 0,
  );
  const physical = watch('physical');

  const addLine = handleSubmit((values) => {
    const line = sale.lines.find((l) => l.id === Number(values.sale_line_id));
    if (!line) return;
    setStagedLines((current) => [
      ...current,
      {
        sale_line_id: line.id,
        quantity_packages: values.quantity_packages,
        economic: values.economic,
        physical: values.physical,
        lot_number: values.physical && values.lot_number ? values.lot_number : null,
        label: `${line.product_sku} — ${line.package_name}`,
      },
    ]);
    reset({
      sale_line_id: '',
      quantity_packages: '1',
      economic: true,
      physical: true,
      lot_number: '',
    });
  });

  const submit = () => {
    if (stagedLines.length === 0) return;
    onSubmit({ notes, lines: stagedLines.map(({ label: _label, ...line }) => line) });
  };

  return (
    <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
      <h4 className="mb-3 text-sm font-semibold text-slate-700">Registrar devolución</h4>

      {stagedLines.length > 0 && (
        <ul className="mb-3 space-y-1 text-sm">
          {stagedLines.map((line, index) => (
            <li key={`${line.sale_line_id}-${index}`} className="flex items-center gap-2">
              <span>
                {line.label} — {formatQuantity(line.quantity_packages)}
                {line.economic && ' · reembolso'}
                {line.physical && ' · repone stock'}
                {line.lot_number && ` · lote ${line.lot_number}`}
              </span>
              <button
                type="button"
                onClick={() => setStagedLines((current) => current.filter((_, i) => i !== index))}
                className="text-xs font-medium text-red-600 hover:underline"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}

      {pendingLines.length > 0 && (
        <form
          onSubmit={(event) => void addLine(event)}
          noValidate
          className="flex flex-wrap items-end gap-2"
        >
          <label className="text-sm text-slate-600">
            Línea vendida
            <select
              className="mt-1 block w-56 rounded border border-slate-300 px-3 py-1.5 text-sm"
              {...register('sale_line_id')}
            >
              <option value="">Elige…</option>
              {pendingLines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.product_sku} — {line.package_name} (pendiente{' '}
                  {formatQuantity(String(remainingPackages(line)))})
                </option>
              ))}
            </select>
            {errors.sale_line_id && (
              <p className="mt-1 text-sm text-red-600">{errors.sale_line_id.message}</p>
            )}
          </label>

          <label className="text-sm text-slate-600">
            Cantidad
            <input
              type="text"
              inputMode="decimal"
              className="mt-1 block w-20 rounded border border-slate-300 px-3 py-1.5 text-sm"
              {...register('quantity_packages')}
            />
            {errors.quantity_packages && (
              <p className="mt-1 text-sm text-red-600">{errors.quantity_packages.message}</p>
            )}
          </label>

          <label className="flex items-center gap-1.5 pb-1.5 text-sm text-slate-600">
            <input type="checkbox" {...register('economic')} />
            Reembolsar
          </label>

          <label className="flex items-center gap-1.5 pb-1.5 text-sm text-slate-600">
            <input type="checkbox" {...register('physical')} />
            Reponer stock
          </label>

          {physical && (
            <label className="text-sm text-slate-600">
              Nº de lote (si aplica)
              <input
                type="text"
                className="mt-1 block w-28 rounded border border-slate-300 px-3 py-1.5 text-sm"
                {...register('lot_number')}
              />
            </label>
          )}

          <button
            type="submit"
            className="rounded bg-slate-700 px-4 py-1.5 text-sm font-medium text-white"
          >
            Añadir a la devolución
          </button>
        </form>
      )}

      <label className="mt-3 block text-sm text-slate-600">
        Notas (opcional)
        <input
          type="text"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="mt-1 w-full max-w-md rounded border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}

      <div className="mt-4">
        <button
          type="button"
          onClick={submit}
          disabled={isPending || stagedLines.length === 0}
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? 'Registrando…' : 'Registrar devolución'}
        </button>
      </div>
    </div>
  );
}
