import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  type RefundMethod,
  type ReturnInput,
  type ReturnLineInput,
  type Sale,
} from '@/features/returns/api';
import { decimalString } from '@/lib/decimal';
import { formatMoney, formatQuantity } from '@/lib/format';

function decimalNumber(value: string): number {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function remainingPackages(
  line: Sale['lines'][number],
  returnedField: 'quantity_refunded' | 'quantity_physically_returned',
): number {
  return (
    (decimalNumber(line.quantity_base) - decimalNumber(line[returnedField])) /
    decimalNumber(line.package_factor)
  );
}

/** El backend calcula el reembolso exacto con los snapshots fiscales de la
 * línea. Antes de confirmarlo enseñamos la parte proporcional del total que
 * figura en el ticket; se redondea como dinero y permite decidir la devolución
 * sin tener que reconstruir mentalmente el importe. */
function estimatedRefundAmount(line: Sale['lines'][number], quantityPackages: number): number {
  const boughtPackages = decimalNumber(line.quantity_packages);
  if (boughtPackages <= 0 || quantityPackages <= 0) return 0;
  return (decimalNumber(line.total) * quantityPackages) / boughtPackages;
}

function quantityStep(line: Sale['lines'][number]): number {
  // Las unidades completas se devuelven de una en una; para peso, volumen y
  // formatos fraccionables el paso permite ajustar gramos/mililitros.
  if (/\b(?:KG|G|L|ML)\b|KILOGRAM|LITRO/i.test(line.package_name)) return 0.001;
  return Number.isInteger(decimalNumber(line.quantity_packages)) ? 1 : 0.001;
}

function decimalForInput(value: number): string {
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

interface QuantityStepperProps {
  label: string;
  value: string;
  max: number;
  step: number;
  onChange: (value: string) => void;
  error?: string | undefined;
}

function QuantityStepper({ label, value, max, step, onChange, error }: QuantityStepperProps) {
  const current = Math.max(0, Math.min(max, decimalNumber(value)));
  const update = (next: number) => onChange(decimalForInput(Math.max(0, Math.min(max, next))));

  return (
    <label className="text-sm text-slate-600">
      {label}
      <span className="mt-1 flex w-36 overflow-hidden rounded border border-slate-300 bg-white">
        <button
          type="button"
          aria-label={`Reducir ${label.toLowerCase()}`}
          disabled={current <= 0}
          onClick={() => update(current - step)}
          className="w-10 border-r border-slate-300 text-lg leading-none text-slate-700 disabled:opacity-35"
        >
          −
        </button>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          className="min-w-0 flex-1 px-2 py-1.5 text-center text-sm outline-none"
        />
        <button
          type="button"
          aria-label={`Aumentar ${label.toLowerCase()}`}
          disabled={current >= max}
          onClick={() => update(current + step)}
          className="w-10 border-l border-slate-300 text-lg leading-none text-slate-700 disabled:opacity-35"
        >
          +
        </button>
      </span>
      <span className="mt-1 block text-xs text-slate-500">
        Máximo: {formatQuantity(String(max))}
      </span>
      {error && <span className="mt-1 block text-sm text-red-600">{error}</span>}
    </label>
  );
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
  submissionSucceeded?: boolean;
}

/** Money and merchandise are independent. A normal return defaults both
 * quantities to one, while either can be reduced to zero for economic-only
 * or goodwill/physical-only operations. */
export function CreateReturnForm({
  sale,
  onSubmit,
  isPending,
  submitError,
  submissionSucceeded = false,
}: CreateReturnFormProps) {
  const [notes, setNotes] = useState('');
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('CASH');
  const [stagedLines, setStagedLines] = useState<StagedLine[]>([]);
  const [isConfirming, setConfirming] = useState(false);
  const [stockQuantityIsManual, setStockQuantityIsManual] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors },
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
  const saleLineField = register('sale_line_id');
  const selectedRefundQuantity = decimalNumber(watch('refund_quantity_packages') ?? '0');
  const stockQuantity = decimalNumber(watch('stock_return_quantity_packages') ?? '0');
  const hasEconomicEffect = stagedLines.some(
    (line) => decimalNumber(line.refund_quantity_packages) > 0,
  );
  const stagedRefundTotal = stagedLines.reduce((total, staged) => {
    const saleLine = sale.lines.find((line) => line.id === staged.sale_line_id);
    return saleLine === undefined
      ? total
      : total + estimatedRefundAmount(saleLine, decimalNumber(staged.refund_quantity_packages));
  }, 0);
  useEffect(() => {
    if (!submissionSucceeded) return;
    setNotes('');
    setStagedLines([]);
    setConfirming(false);
    setStockQuantityIsManual(false);
    reset({
      sale_line_id: '',
      refund_quantity_packages: '1',
      stock_return_quantity_packages: '1',
      lot_number: '',
    });
  }, [reset, submissionSucceeded]);

  const addLine = handleSubmit((values) => {
    const line = sale.lines.find((candidate) => candidate.id === Number(values.sale_line_id));
    if (!line) return;
    const refundable = remainingPackages(line, 'quantity_refunded');
    const returnableToStock = remainingPackages(line, 'quantity_physically_returned');
    if (decimalNumber(values.refund_quantity_packages) > refundable) {
      setError('refund_quantity_packages', {
        message: `La cantidad a reembolsar supera el máximo disponible (${formatQuantity(String(refundable))}).`,
      });
      return;
    }
    if (decimalNumber(values.stock_return_quantity_packages) > returnableToStock) {
      setError('stock_return_quantity_packages', {
        message: `La cantidad que vuelve a stock supera el máximo disponible (${formatQuantity(String(returnableToStock))}).`,
      });
      return;
    }
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
        label: `${line.product_name} — ${line.package_name}`,
      },
    ]);
    reset({
      sale_line_id: '',
      refund_quantity_packages: '1',
      stock_return_quantity_packages: '1',
      lot_number: '',
    });
    setStockQuantityIsManual(false);
  });

  const requestConfirmation = () => {
    if (stagedLines.length === 0) return;
    setConfirming(true);
  };

  const submit = () => {
    if (stagedLines.length === 0) return;
    setConfirming(false);
    onSubmit({
      notes,
      lines: stagedLines.map(({ label: _label, ...line }) => line),
      ...(hasEconomicEffect ? { refund_method: refundMethod } : {}),
    });
  };

  const selectedRefundMaximum = selectedLine
    ? Math.max(0, remainingPackages(selectedLine, 'quantity_refunded'))
    : 0;
  const stockMaximum = selectedLine
    ? Math.max(0, remainingPackages(selectedLine, 'quantity_physically_returned'))
    : 0;
  const selectedStep = selectedLine ? quantityStep(selectedLine) : 1;

  return (
    <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
      <h4 className="mb-3 text-sm font-semibold text-slate-700">Registrar devolución</h4>

      <div className="mb-4 overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <caption className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase text-slate-600">
            Líneas del ticket
          </caption>
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Artículo</th>
              <th className="px-3 py-2 font-medium">Comprado</th>
              <th className="px-3 py-2 font-medium">Ya devuelto</th>
              <th className="px-3 py-2 font-medium">Pendiente</th>
              <th className="px-3 py-2 font-medium">Importe pendiente</th>
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((line) => {
              const pendingRefund = remainingPackages(line, 'quantity_refunded');
              return (
                <tr key={line.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {line.product_name}
                    <span className="block text-xs font-normal text-slate-500">
                      {line.package_name}
                    </span>
                  </td>
                  <td className="px-3 py-2">{formatQuantity(line.quantity_packages)}</td>
                  <td className="px-3 py-2">{formatQuantity(line.quantity_refunded)}</td>
                  <td className="px-3 py-2">
                    {formatQuantity(String(Math.max(0, pendingRefund)))}
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {formatMoney(String(estimatedRefundAmount(line, Math.max(0, pendingRefund))))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {stagedLines.length > 0 && (
        <div className="mb-3 overflow-x-auto rounded border border-brand-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-50 text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">A devolver</th>
                <th className="px-3 py-2 font-medium">Dinero</th>
                <th className="px-3 py-2 font-medium">Vuelve a stock</th>
                <th className="px-3 py-2 font-medium">Importe</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {stagedLines.map((line, index) => {
                const saleLine = sale.lines.find((candidate) => candidate.id === line.sale_line_id);
                return (
                  <tr key={`${line.sale_line_id}-${index}`} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {line.label}
                      {line.lot_number && (
                        <span className="block text-xs font-normal text-slate-500">
                          Lote {line.lot_number}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{formatQuantity(line.refund_quantity_packages)}</td>
                    <td className="px-3 py-2">
                      {formatQuantity(line.stock_return_quantity_packages)}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {formatMoney(
                        String(
                          saleLine === undefined
                            ? 0
                            : estimatedRefundAmount(
                                saleLine,
                                decimalNumber(line.refund_quantity_packages),
                              ),
                        ),
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setStagedLines((current) => current.filter((_, i) => i !== index))
                        }
                        className="text-xs font-medium text-red-600 hover:underline"
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-brand-100 bg-brand-50 px-3 py-2 text-right text-sm font-semibold text-slate-800">
            Importe total a devolver: {formatMoney(String(stagedRefundTotal))}
          </p>
        </div>
      )}

      {pendingLines.length > 0 && (
        <form
          onSubmit={(event) => void addLine(event)}
          noValidate
          className="flex flex-wrap items-end gap-2"
        >
          <input type="hidden" {...register('refund_quantity_packages')} />
          <input type="hidden" {...register('stock_return_quantity_packages')} />
          <label className="text-sm text-slate-600">
            Línea vendida
            <select
              className="mt-1 block w-64 rounded border border-slate-300 px-3 py-1.5 text-sm"
              {...saleLineField}
              onChange={(event) => {
                void saleLineField.onChange(event);
                setStockQuantityIsManual(false);
                const line = sale.lines.find(
                  (candidate) => candidate.id === Number(event.target.value),
                );
                if (!line) return;
                setValue(
                  'refund_quantity_packages',
                  decimalForInput(Math.min(1, remainingPackages(line, 'quantity_refunded'))),
                  { shouldValidate: true },
                );
                setValue(
                  'stock_return_quantity_packages',
                  decimalForInput(
                    Math.min(1, remainingPackages(line, 'quantity_physically_returned')),
                  ),
                  { shouldValidate: true },
                );
              }}
            >
              <option value="">Elige…</option>
              {pendingLines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.product_name} — {line.package_name} (dinero{' '}
                  {formatQuantity(String(remainingPackages(line, 'quantity_refunded')))}, stock{' '}
                  {formatQuantity(String(remainingPackages(line, 'quantity_physically_returned')))})
                </option>
              ))}
            </select>
            {errors.sale_line_id && (
              <p className="mt-1 text-sm text-red-600">{errors.sale_line_id.message}</p>
            )}
          </label>

          <QuantityStepper
            label="Cantidad a devolver"
            value={watch('refund_quantity_packages') ?? '0'}
            max={selectedRefundMaximum}
            step={selectedStep}
            onChange={(value) => {
              setValue('refund_quantity_packages', value, {
                shouldDirty: true,
                shouldValidate: true,
              });
              if (!stockQuantityIsManual) {
                setValue('stock_return_quantity_packages', value, {
                  shouldValidate: true,
                });
              }
            }}
            error={errors.refund_quantity_packages?.message}
          />

          <QuantityStepper
            label="Cantidad que vuelve a stock"
            value={watch('stock_return_quantity_packages') ?? '0'}
            max={stockMaximum}
            step={selectedStep}
            onChange={(value) => {
              setStockQuantityIsManual(true);
              setValue('stock_return_quantity_packages', value, {
                shouldDirty: true,
                shouldValidate: true,
              });
            }}
            error={errors.stock_return_quantity_packages?.message}
          />

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

          {selectedLine && selectedRefundQuantity > 0 && (
            <p className="pb-1 text-sm font-medium text-emerald-800">
              Importe a devolver de esta línea:{' '}
              {formatMoney(String(estimatedRefundAmount(selectedLine, selectedRefundQuantity)))}
            </p>
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
          onClick={requestConfirmation}
          disabled={isPending || stagedLines.length === 0}
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? 'Registrando…' : 'Registrar devolución'}
        </button>
      </div>

      {isConfirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar devolución"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h5 className="text-lg font-semibold text-slate-900">Confirmar devolución</h5>
            <p className="mt-2 text-sm text-slate-600">
              Se devolverán {formatMoney(String(stagedRefundTotal))} y se registrarán las cantidades
              indicadas. Esta operación no se puede deshacer automáticamente.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={isPending}
                className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Confirmar devolución
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
