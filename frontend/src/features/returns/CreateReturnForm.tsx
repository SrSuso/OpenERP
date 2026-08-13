import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  type RefundMethod,
  type ReturnInput,
  type ReturnLineInput,
  type Sale,
} from '@/features/returns/api';
import { decimalString } from '@/lib/decimal';
import { formatQuantity } from '@/lib/format';

function remainingPackages(
  line: Sale['lines'][number],
  returnedField: 'quantity_refunded' | 'quantity_physically_returned',
): number {
  return (Number(line.quantity_base) - Number(line[returnedField])) / Number(line.package_factor);
}

const addLineSchema = z
  .object({
    sale_line_id: z.string().min(1, 'Elige una línea.'),
    refund_quantity_packages: decimalString({ min: 0 }),
    stock_return_quantity_packages: decimalString({ min: 0 }),
    lot_number: z.string().max(100).optional(),
  })
  .superRefine((values, context) => {
    if (
      Number(values.refund_quantity_packages) === 0 &&
      Number(values.stock_return_quantity_packages) === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['refund_quantity_packages'],
        message: 'Indica una cantidad económica o física.',
      });
    }
  });

type AddLineFormValues = z.infer<typeof addLineSchema>;

interface StagedLine extends ReturnLineInput {
  label: string;
}

interface CreateReturnFormProps {
  sale: Sale;
  onSubmit: (payload: ReturnInput) => void;
  isPending: boolean;
  submitError: string | null;
}

/** Money and merchandise are independent. A normal return defaults both
 * quantities to one, while either can be reduced to zero for economic-only
 * or goodwill/physical-only operations. */
export function CreateReturnForm({
  sale,
  onSubmit,
  isPending,
  submitError,
}: CreateReturnFormProps) {
  const [notes, setNotes] = useState('');
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('CASH');
  const [stagedLines, setStagedLines] = useState<StagedLine[]>([]);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { dirtyFields, errors },
  } = useForm<AddLineFormValues>({
    resolver: zodResolver(addLineSchema),
    defaultValues: {
      refund_quantity_packages: '1',
      stock_return_quantity_packages: '1',
    },
  });

  const stagedIds = new Set(stagedLines.map((line) => line.sale_line_id));
  const pendingLines = sale.lines.filter(
    (line) =>
      !stagedIds.has(line.id) &&
      (remainingPackages(line, 'quantity_refunded') > 0 ||
        remainingPackages(line, 'quantity_physically_returned') > 0),
  );
  const selectedLine = sale.lines.find((line) => line.id === Number(watch('sale_line_id')));
  const stockQuantity = Number(watch('stock_return_quantity_packages') ?? 0);
  const hasEconomicEffect = stagedLines.some((line) => Number(line.refund_quantity_packages) > 0);
  const refundQuantityField = register('refund_quantity_packages');

  const addLine = handleSubmit((values) => {
    const line = sale.lines.find((candidate) => candidate.id === Number(values.sale_line_id));
    if (!line) return;
    setStagedLines((current) => [
      ...current,
      {
        sale_line_id: line.id,
        refund_quantity_packages: values.refund_quantity_packages,
        stock_return_quantity_packages: values.stock_return_quantity_packages,
        lot_number:
          Number(values.stock_return_quantity_packages) > 0 && values.lot_number
            ? values.lot_number
            : null,
        label: `${line.product_sku} — ${line.package_name}`,
      },
    ]);
    reset({
      sale_line_id: '',
      refund_quantity_packages: '1',
      stock_return_quantity_packages: '1',
      lot_number: '',
    });
  });

  const submit = () => {
    if (stagedLines.length === 0) return;
    onSubmit({
      notes,
      lines: stagedLines.map(({ label: _label, ...line }) => line),
      ...(hasEconomicEffect ? { refund_method: refundMethod } : {}),
    });
  };

  return (
    <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
      <h4 className="mb-3 text-sm font-semibold text-slate-700">Registrar devolución</h4>

      {stagedLines.length > 0 && (
        <ul className="mb-3 space-y-1 text-sm">
          {stagedLines.map((line, index) => (
            <li key={`${line.sale_line_id}-${index}`} className="flex items-center gap-2">
              <span>
                {line.label}
                {Number(line.refund_quantity_packages) > 0 &&
                  ` · devuelve ${formatQuantity(line.refund_quantity_packages)}`}
                {Number(line.stock_return_quantity_packages) > 0 &&
                  ` · repone ${formatQuantity(line.stock_return_quantity_packages)}`}
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
              className="mt-1 block w-64 rounded border border-slate-300 px-3 py-1.5 text-sm"
              {...register('sale_line_id')}
            >
              <option value="">Elige…</option>
              {pendingLines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.product_sku} — {line.package_name} (dinero{' '}
                  {formatQuantity(String(remainingPackages(line, 'quantity_refunded')))}, stock{' '}
                  {formatQuantity(String(remainingPackages(line, 'quantity_physically_returned')))})
                </option>
              ))}
            </select>
            {errors.sale_line_id && (
              <p className="mt-1 text-sm text-red-600">{errors.sale_line_id.message}</p>
            )}
          </label>

          <label className="text-sm text-slate-600">
            Cantidad a reembolsar
            <input
              type="text"
              inputMode="decimal"
              className="mt-1 block w-24 rounded border border-slate-300 px-3 py-1.5 text-sm"
              {...refundQuantityField}
              onChange={(event) => {
                void refundQuantityField.onChange(event);
                if (!dirtyFields.stock_return_quantity_packages) {
                  setValue('stock_return_quantity_packages', event.target.value);
                }
              }}
            />
            {errors.refund_quantity_packages && (
              <p className="mt-1 text-sm text-red-600">{errors.refund_quantity_packages.message}</p>
            )}
          </label>

          <label className="text-sm text-slate-600">
            Cantidad que vuelve a stock
            <input
              type="text"
              inputMode="decimal"
              className="mt-1 block w-24 rounded border border-slate-300 px-3 py-1.5 text-sm"
              {...register('stock_return_quantity_packages')}
            />
            {errors.stock_return_quantity_packages && (
              <p className="mt-1 text-sm text-red-600">
                {errors.stock_return_quantity_packages.message}
              </p>
            )}
          </label>

          {stockQuantity > 0 && selectedLine?.track_lots && (
            <label className="text-sm text-slate-600">
              Nº de lote
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

      {hasEconomicEffect && (
        <label className="mt-3 block text-sm text-slate-600">
          Medio del reembolso
          <select
            value={refundMethod}
            onChange={(event) => setRefundMethod(event.target.value as RefundMethod)}
            className="mt-1 block rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="CASH">Efectivo entregado</option>
            <option value="CARD">Tarjeta — confirmado en datáfono</option>
            <option value="OTHER">Otro medio ya realizado</option>
          </select>
        </label>
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
