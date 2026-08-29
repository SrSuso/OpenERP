import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { locationsQuery, warehousesQuery } from '@/features/inventory/api';
import { useDefaultToFirstOption } from '@/features/inventory/useDefaultToFirstOption';
import { type GoodsReceiptLineInput, type PurchaseOrder } from '@/features/purchasing/api';
import { decimalInputValue } from '@/lib/decimal';
import { formatQuantity } from '@/lib/format';

function remainingPackages(line: PurchaseOrder['lines'][number]): number {
  return (
    (Number(line.quantity_ordered) - Number(line.quantity_received)) / Number(line.package_factor)
  );
}

function normalizedPositiveQuantity(value: string): string | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric > 0 ? normalized : null;
}

interface ReceiptDraftLine extends GoodsReceiptLineInput {
  id: number;
  product_name: string;
  track_lots: boolean;
  package_name: string;
  remaining_packages: number;
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

/** Todas las líneas pendientes se cargan con su cantidad pendiente. Normalmente
 * basta con corregir las entregas parciales y registrar toda la tabla una vez. */
export function GoodsReceiptForm({
  order,
  onSubmit,
  onCancel,
  isPending,
  submitError,
}: GoodsReceiptFormProps) {
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [locationId, setLocationId] = useState('');
  const [lineError, setLineError] = useState<string | null>(null);
  const [receiptLines, setReceiptLines] = useState<ReceiptDraftLine[]>(() =>
    order.lines.flatMap((line) => {
      const remaining = remainingPackages(line);
      if (remaining <= 0) return [];
      return [
        {
          id: line.id,
          product_name: line.product_name,
          track_lots: line.track_lots,
          package_name: line.package_name,
          remaining_packages: remaining,
          purchase_order_line_id: line.id,
          quantity_packages: decimalInputValue(String(remaining)),
          lot_number: null,
          manufacturing_date: null,
          expiration_date: null,
        },
      ];
    }),
  );

  const warehouses = useQuery(warehousesQuery);
  const locations = useQuery(locationsQuery(warehouseId === '' ? null : Number(warehouseId)));

  useDefaultToFirstOption(warehouseId, warehouses.data, setWarehouseId);
  useDefaultToFirstOption(locationId, locations.data, setLocationId);

  const updateLine = (lineId: number, patch: Partial<ReceiptDraftLine>) => {
    setLineError(null);
    setReceiptLines((current) =>
      current.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
    );
  };

  const submit = () => {
    if (warehouseId === '' || locationId === '') return;

    const lines: GoodsReceiptLineInput[] = [];
    for (const line of receiptLines) {
      const quantity = line.quantity_packages.trim();
      if (quantity === '' || Number(quantity.replace(',', '.')) === 0) continue;
      const normalizedQuantity = normalizedPositiveQuantity(quantity);
      if (normalizedQuantity === null) {
        setLineError(`La cantidad de «${line.product_name}» no es válida.`);
        return;
      }
      if (Number(normalizedQuantity) > line.remaining_packages + 0.000001) {
        setLineError(
          `La cantidad de «${line.product_name}» no puede superar las ${formatQuantity(String(line.remaining_packages))} pendientes.`,
        );
        return;
      }
      const lotNumber = line.lot_number?.trim() || null;
      if (line.track_lots && lotNumber === null) {
        setLineError(`«${line.product_name}» requiere un número de lote para registrarlo.`);
        return;
      }
      lines.push({
        purchase_order_line_id: line.purchase_order_line_id,
        quantity_packages: normalizedQuantity,
        lot_number: lotNumber,
        manufacturing_date: line.manufacturing_date || null,
        expiration_date: line.expiration_date || null,
      });
    }

    if (lines.length === 0) {
      setLineError('Indica al menos una cantidad recibida.');
      return;
    }
    onSubmit({
      warehouse_id: Number(warehouseId),
      location_id: Number(locationId),
      notes,
      lines,
    });
  };

  return (
    <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
      <h4 className="mb-1 text-sm font-semibold text-slate-700">Registrar recepción</h4>
      <p className="mb-3 text-xs text-slate-600">
        Se han cargado las cantidades pendientes. Cambia sólo las líneas que hayan llegado
        incompletas; escribe 0 para no recibir una línea todavía.
      </p>

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

      {receiptLines.length > 0 ? (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Producto</th>
                <th className="px-3 py-2 font-medium">Unidad</th>
                <th className="px-3 py-2 font-medium">Pendiente</th>
                <th className="px-3 py-2 font-medium">Recibir ahora</th>
                <th className="px-3 py-2 font-medium">Lote</th>
                <th className="px-3 py-2 font-medium">Caducidad</th>
              </tr>
            </thead>
            <tbody>
              {receiptLines.map((line) => (
                <tr key={line.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {line.product_name}
                    {line.track_lots && (
                      <span className="mt-0.5 block text-xs font-normal text-amber-700">
                        Lote obligatorio
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{line.package_name}</td>
                  <td className="px-3 py-2">{formatQuantity(String(line.remaining_packages))}</td>
                  <td className="px-3 py-2">
                    <input
                      aria-label={`Cantidad recibida de ${line.product_name}`}
                      type="text"
                      inputMode="decimal"
                      value={line.quantity_packages}
                      onChange={(event) =>
                        updateLine(line.id, { quantity_packages: event.target.value })
                      }
                      className="w-24 rounded border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      aria-label={`Lote de ${line.product_name}`}
                      type="text"
                      disabled={!line.track_lots}
                      placeholder={line.track_lots ? 'Obligatorio' : 'No requiere lote'}
                      aria-required={line.track_lots}
                      value={line.lot_number ?? ''}
                      onChange={(event) => updateLine(line.id, { lot_number: event.target.value })}
                      className="w-36 rounded border border-slate-300 px-2 py-1.5 text-sm placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      aria-label={`Caducidad de ${line.product_name}`}
                      type="date"
                      value={line.expiration_date ?? ''}
                      onChange={(event) =>
                        updateLine(line.id, { expiration_date: event.target.value || null })
                      }
                      className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Este pedido ya no tiene líneas pendientes.</p>
      )}

      {lineError && <p className="mt-3 text-sm text-red-600">{lineError}</p>}
      {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={
            isPending || warehouseId === '' || locationId === '' || receiptLines.length === 0
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
