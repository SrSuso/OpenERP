import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { locationsQuery, warehousesQuery } from '@/features/inventory/api';
import { consumeFefo, lotBalancesQuery, planFefo, type FefoAllocation } from '@/features/lots/api';
import { ApiError } from '@/lib/api';
import { decimalString } from '@/lib/decimal';
import { formatQuantity } from '@/lib/format';

interface LotBalancesPanelProps {
  productId: number;
  canManage: boolean;
}

/** Saldo por lote en un almacén/ubicación, y la herramienta FEFO: previsualizar
 * qué lotes consumiría una salida de X unidades (primero el que antes caduca)
 * y, si se confirma, ejecutarla de verdad como un ajuste/merma. */
export function LotBalancesPanel({ productId, canManage }: LotBalancesPanelProps) {
  const [warehouseId, setWarehouseId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [movementType, setMovementType] = useState<'ADJUSTMENT' | 'WASTE'>('ADJUSTMENT');
  const [unitCost, setUnitCost] = useState('0');
  const [reason, setReason] = useState('');
  const [plan, setPlan] = useState<FefoAllocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const warehouses = useQuery(warehousesQuery);
  const locations = useQuery(locationsQuery(warehouseId === '' ? null : Number(warehouseId)));
  const balances = useQuery({
    ...lotBalancesQuery(productId, Number(warehouseId), Number(locationId)),
    enabled: warehouseId !== '' && locationId !== '',
  });

  const quantityValid = decimalString({ min: 0.000001 }).safeParse(quantity).success;

  const planMutation = useMutation({
    mutationFn: () =>
      planFefo(productId, {
        warehouse_id: Number(warehouseId),
        location_id: Number(locationId),
        quantity,
      }),
    onSuccess: (allocations) => {
      setPlan(allocations);
      setError(null);
    },
    onError: (err: unknown) => {
      setPlan(null);
      setError(err instanceof ApiError ? err.message : 'No se ha podido calcular el plan FEFO.');
    },
  });

  const consumeMutation = useMutation({
    mutationFn: () =>
      consumeFefo(productId, {
        warehouse_id: Number(warehouseId),
        location_id: Number(locationId),
        quantity,
        movement_type: movementType,
        unit_cost: unitCost,
        reason,
      }),
    onSuccess: (allocations) => {
      setPlan(allocations);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['lots', 'balances', productId] });
    },
    onError: (err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'No se ha podido consumir el stock.'),
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Saldo por lote y FEFO</h3>

      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-slate-600">
          Almacén
          <select
            value={warehouseId}
            onChange={(event) => {
              setWarehouseId(event.target.value);
              setLocationId('');
              setPlan(null);
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
            onChange={(event) => {
              setLocationId(event.target.value);
              setPlan(null);
            }}
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
      </div>

      {warehouseId !== '' && locationId !== '' && (
        <>
          {balances.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
          {balances.data && balances.data.length === 0 && (
            <p className="mb-3 text-sm text-slate-500">Sin stock de este producto aquí.</p>
          )}
          {balances.data && balances.data.length > 0 && (
            <table className="mb-4 w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Lote</th>
                  <th className="py-1 pr-3 font-medium">Caducidad</th>
                  <th className="py-1 pr-3 font-medium">Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {balances.data.map((balance) => (
                  <tr key={balance.lot.id} className="border-t border-slate-200">
                    <td className="py-1 pr-3">{balance.lot.lot_number}</td>
                    <td className="py-1 pr-3">{balance.lot.expiration_date ?? '—'}</td>
                    <td className="py-1 pr-3">{formatQuantity(balance.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {canManage && (
            <div className="rounded border border-dashed border-slate-300 p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">
                Salida FEFO (primero lo que antes caduca)
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm text-slate-600">
                  Cantidad a sacar
                  <input
                    type="text"
                    inputMode="decimal"
                    value={quantity}
                    onChange={(event) => {
                      setQuantity(event.target.value);
                      setPlan(null);
                    }}
                    className="mt-1 block w-24 rounded border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => planMutation.mutate()}
                  disabled={!quantityValid || planMutation.isPending}
                  className="rounded bg-slate-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Ver plan
                </button>
              </div>

              {plan && (
                <ul className="mt-3 space-y-1 text-sm">
                  {plan.map((allocation) => (
                    <li key={allocation.lot_id}>
                      Lote {allocation.lot_number}
                      {allocation.expiration_date &&
                        ` (caduca ${allocation.expiration_date})`} —{' '}
                      {formatQuantity(allocation.quantity)}
                    </li>
                  ))}
                </ul>
              )}

              {plan && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="text-sm text-slate-600">
                    Tipo
                    <select
                      value={movementType}
                      onChange={(event) =>
                        setMovementType(event.target.value as 'ADJUSTMENT' | 'WASTE')
                      }
                      className="mt-1 block rounded border border-slate-300 px-3 py-1.5 text-sm"
                    >
                      <option value="ADJUSTMENT">Ajuste</option>
                      <option value="WASTE">Merma</option>
                    </select>
                  </label>
                  <label className="text-sm text-slate-600">
                    Coste/ud.
                    <input
                      type="text"
                      inputMode="decimal"
                      value={unitCost}
                      onChange={(event) => setUnitCost(event.target.value)}
                      className="mt-1 block w-24 rounded border border-slate-300 px-3 py-1.5 text-sm"
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    Motivo (opcional)
                    <input
                      type="text"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      className="mt-1 block w-40 rounded border border-slate-300 px-3 py-1.5 text-sm"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => consumeMutation.mutate()}
                    disabled={consumeMutation.isPending}
                    className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {consumeMutation.isPending ? 'Consumiendo…' : 'Confirmar salida'}
                  </button>
                </div>
              )}

              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
