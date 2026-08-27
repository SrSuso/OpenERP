import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { locationsQuery, warehousesQuery } from '@/features/inventory/api';
import { useDefaultToFirstOption } from '@/features/inventory/useDefaultToFirstOption';
import { type GoodsReceiptLineInput, type PurchaseOrder } from '@/features/purchasing/api';
import { decimalString } from '@/lib/decimal';
import { formatQuantity } from '@/lib/format';

function remainingPackages(line: PurchaseOrder['lines'][number]): number {
  return (
    (Number(line.quantity_ordered) - Number(line.quantity_received)) / Number(line.package_factor)
  );
}

const addLineSchema = z.object({
  purchase_order_line_id: z.string().min(1, 'Elige una línea.'),
  quantity_packages: decimalString({ min: 0.000001 }),
  lot_number: z.string().max(100).optional(),
  manufacturing_date: z.string().optional(),
  expiration_date: z.string().optional(),
});

type AddLineFormValues = z.infer<typeof addLineSchema>;

interface StagedLine extends GoodsReceiptLineInput {
  label: string;
}

interface GoodsReceiptFormProps {
  order: PurchaseOrder;
  onSubmit: (payload: {
    warehouse_id: number;
    location_id: number;
    notes: string;
    lines: GoodsReceiptLineInput[];
  }) => void;
  onCancel: () => void;
  isPending: boolean;
  submitError: string | null;
}

/** Registrar una entrega física contra un pedido `ORDERED`/`PARTIALLY_RECEIVED`
 * — una recepción puede cubrir varias líneas a la vez (backend/app/purchasing
 * /schemas.py's `GoodsReceiptCreate`), así que se van apilando localmente
 * antes de mandarlas todas juntas. */
export function GoodsReceiptForm({
  order,
  onSubmit,
  onCancel,
  isPending,
  submitError,
}: GoodsReceiptFormProps) {
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [stagedLines, setStagedLines] = useState<StagedLine[]>([]);
  const [locationId, setLocationId] = useState('');

  const warehouses = useQuery(warehousesQuery);
  const locations = useQuery(locationsQuery(warehouseId === '' ? null : Number(warehouseId)));

  useDefaultToFirstOption(warehouseId, warehouses.data, setWarehouseId);
  useDefaultToFirstOption(locationId, locations.data, setLocationId);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddLineFormValues>({ resolver: zodResolver(addLineSchema) });

  const stagedIds = new Set(stagedLines.map((line) => line.purchase_order_line_id));
  const pendingLines = order.lines.filter(
    (line) => !stagedIds.has(line.id) && remainingPackages(line) > 0,
  );

  const addLine = handleSubmit((values) => {
    const line = order.lines.find((l) => l.id === Number(values.purchase_order_line_id));
    if (!line) return;
    setStagedLines((current) => [
      ...current,
      {
        purchase_order_line_id: line.id,
        quantity_packages: values.quantity_packages,
        lot_number: values.lot_number === '' ? null : (values.lot_number ?? null),
        manufacturing_date:
          values.manufacturing_date === '' ? null : (values.manufacturing_date ?? null),
        expiration_date: values.expiration_date === '' ? null : (values.expiration_date ?? null),
        label: `${line.product_name} — ${line.package_name}`,
      },
    ]);
    reset({
      purchase_order_line_id: '',
      quantity_packages: '1',
      lot_number: '',
      manufacturing_date: '',
      expiration_date: '',
    });
  });

  const submit = () => {
    if (warehouseId === '' || locationId === '' || stagedLines.length === 0) return;
    onSubmit({
      warehouse_id: Number(warehouseId),
      location_id: Number(locationId),
      notes,
      lines: stagedLines.map(({ label: _label, ...line }) => line),
    });
  };

  return (
    <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
      <h4 className="mb-3 text-sm font-semibold text-slate-700">Registrar recepción</h4>

      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-slate-600">
          Almacén
          <select
            value={warehouseId}
            onChange={(event) => {
              setWarehouseId(event.target.value);
              setLocationId('');
            }}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Elige un almacén…</option>
            {(warehouses.data ?? []).map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm text-slate-600">
          Ubicación
          <select
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            disabled={warehouseId === ''}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
          >
            <option value="">Elige una ubicación…</option>
            {(locations.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm text-slate-600">
          Notas (opcional)
          <input
            type="text"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
      </div>

      {stagedLines.length > 0 && (
        <ul className="mb-3 space-y-1 text-sm">
          {stagedLines.map((line, index) => (
            <li key={`${line.purchase_order_line_id}-${index}`} className="flex items-center gap-2">
              <span>
                {line.label} — {formatQuantity(line.quantity_packages)}
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
            Línea pendiente
            <select
              className="mt-1 block w-56 rounded border border-slate-300 px-3 py-1.5 text-sm"
              {...register('purchase_order_line_id')}
            >
              <option value="">Elige…</option>
              {pendingLines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.product_name} — {line.package_name} (pendiente{' '}
                  {formatQuantity(String(remainingPackages(line)))})
                </option>
              ))}
            </select>
            {errors.purchase_order_line_id && (
              <p className="mt-1 text-sm text-red-600">{errors.purchase_order_line_id.message}</p>
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

          <label className="text-sm text-slate-600">
            Nº de lote (opcional)
            <input
              type="text"
              className="mt-1 block w-28 rounded border border-slate-300 px-3 py-1.5 text-sm"
              {...register('lot_number')}
            />
          </label>

          <label className="text-sm text-slate-600">
            Caducidad (opcional)
            <input
              type="date"
              className="mt-1 block rounded border border-slate-300 px-3 py-1.5 text-sm"
              {...register('expiration_date')}
            />
          </label>

          <button
            type="submit"
            className="rounded bg-slate-700 px-4 py-1.5 text-sm font-medium text-white"
          >
            Añadir a la recepción
          </button>
        </form>
      )}

      {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={
            isPending || warehouseId === '' || locationId === '' || stagedLines.length === 0
          }
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? 'Registrando…' : 'Registrar recepción'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
