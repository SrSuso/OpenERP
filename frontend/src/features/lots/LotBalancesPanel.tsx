import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { Alert, Button, Card, EmptyState, FormField, Input } from '@/components/ui';
import { locationsQuery, warehousesQuery } from '@/features/inventory/api';
import {
  consumeFefo,
  lotBalancesQuery,
  planFefo,
  type FefoAllocation,
  type FefoConsumeInput,
} from '@/features/lots/api';
import { ApiError } from '@/lib/api';
import { decimalString } from '@/lib/decimal';
import { formatQuantity } from '@/lib/format';

interface LotBalancesPanelProps {
  productId: number;
  productName: string;
  selectedLotId?: number | null;
  canManage: boolean;
}

export function LotBalancesPanel({
  productId,
  productName,
  selectedLotId = null,
  canManage,
}: LotBalancesPanelProps) {
  const [warehouseId, setWarehouseId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [registering, setRegistering] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [movementType, setMovementType] = useState<'ADJUSTMENT' | 'WASTE'>('ADJUSTMENT');
  const [unitCost, setUnitCost] = useState('0');
  const [reason, setReason] = useState('');
  const [plan, setPlan] = useState<FefoAllocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const consumeAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const queryClient = useQueryClient();

  const warehouses = useQuery(warehousesQuery);
  const activeWarehouses = (warehouses.data ?? []).filter((warehouse) => warehouse.is_active);
  const locations = useQuery(locationsQuery(warehouseId === '' ? null : Number(warehouseId)));
  const activeLocations = (locations.data ?? []).filter((location) => location.is_active);
  const balances = useQuery({
    ...lotBalancesQuery(productId, Number(warehouseId), Number(locationId)),
    enabled: warehouseId !== '' && locationId !== '',
  });

  useEffect(() => {
    if (activeWarehouses.length === 1 && warehouseId === '') {
      setWarehouseId(String(activeWarehouses[0]!.id));
    }
  }, [activeWarehouses, warehouseId]);

  useEffect(() => {
    if (activeLocations.length === 1 && locationId === '') {
      setLocationId(String(activeLocations[0]!.id));
    }
  }, [activeLocations, locationId]);

  const quantityValid = decimalString({ min: 0.000001 }).safeParse(quantity).success;
  const costValid = decimalString({ min: 0 }).safeParse(unitCost).success;

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
      setSuccess(null);
    },
    onError: (err: unknown) => {
      setPlan(null);
      setError(err instanceof ApiError ? err.message : 'No se ha podido previsualizar la salida.');
    },
  });

  const consumeMutation = useMutation({
    mutationFn: ({ payload, key }: { payload: FefoConsumeInput; key: string }) =>
      consumeFefo(productId, payload, key),
    onSuccess: () => {
      consumeAttemptRef.current = null;
      setPlan(null);
      setRegistering(false);
      setQuantity('');
      setReason('');
      setError(null);
      setSuccess('Salida registrada correctamente.');
      void queryClient.invalidateQueries({ queryKey: ['lots', 'balances', productId] });
    },
    onError: (err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'No se ha podido registrar la salida.'),
  });

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Existencias por lote</h2>
          <p className="mt-1 text-sm text-slate-600">{productName}</p>
        </div>
        {canManage && warehouseId && locationId && !registering && (
          <Button
            variant="secondary"
            onClick={() => {
              setRegistering(true);
              setSuccess(null);
            }}
          >
            Registrar salida
          </Button>
        )}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <FormField label="Almacén" htmlFor="lot-balance-warehouse">
          <select
            id="lot-balance-warehouse"
            value={warehouseId}
            onChange={(event) => {
              setWarehouseId(event.target.value);
              setLocationId('');
              setPlan(null);
            }}
            className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Elige un almacén…</option>
            {activeWarehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Ubicación" htmlFor="lot-balance-location">
          <select
            id="lot-balance-location"
            value={locationId}
            onChange={(event) => {
              setLocationId(event.target.value);
              setPlan(null);
            }}
            disabled={!warehouseId}
            className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
          >
            <option value="">Elige una ubicación…</option>
            {activeLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      {success && (
        <div className="mt-4">
          <Alert tone="success">{success}</Alert>
        </div>
      )}
      {balances.isError && (
        <div className="mt-4">
          <Alert tone="error">No se han podido cargar las existencias.</Alert>
        </div>
      )}
      {warehouseId && locationId && balances.isPending && (
        <p className="mt-4 text-sm text-slate-500">Cargando existencias…</p>
      )}
      {balances.data && balances.data.length === 0 && (
        <div className="mt-5">
          <EmptyState
            title="No hay existencias de este producto aquí"
            description="El lote puede existir aunque su saldo actual sea cero."
          />
        </div>
      )}
      {balances.data && balances.data.length > 0 && (
        <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Lote</th>
                <th className="px-4 py-3">Caducidad</th>
                <th className="px-4 py-3 text-right">Cantidad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {balances.data.map((balance) => (
                <tr
                  key={balance.lot.id}
                  className={balance.lot.id === selectedLotId ? 'bg-brand-50' : ''}
                >
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    {balance.lot.lot_number}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {balance.lot.expiration_date ?? 'Sin fecha'}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {formatQuantity(balance.quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {registering && (
        <div className="mt-5 rounded-xl border border-brand-200 bg-brand-50/40 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-900">Registrar salida</h3>
              <p className="mt-1 text-sm text-slate-600">
                OpenERP utilizará primero los lotes que caducan antes.
              </p>
            </div>
            <Button
              variant="ghost"
              className="min-h-8 px-3 py-1"
              onClick={() => {
                setRegistering(false);
                setPlan(null);
                setError(null);
              }}
            >
              Cerrar
            </Button>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Cantidad" htmlFor="lot-output-quantity">
              <Input
                id="lot-output-quantity"
                inputMode="decimal"
                value={quantity}
                onChange={(event) => {
                  setQuantity(event.target.value);
                  setPlan(null);
                }}
              />
            </FormField>
            <FormField label="Motivo" htmlFor="lot-output-type">
              <select
                id="lot-output-type"
                value={movementType}
                onChange={(event) => {
                  setMovementType(event.target.value as 'ADJUSTMENT' | 'WASTE');
                  setPlan(null);
                }}
                className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="ADJUSTMENT">Ajuste</option>
                <option value="WASTE">Merma</option>
              </select>
            </FormField>
            <FormField label="Coste por unidad" htmlFor="lot-output-cost">
              <Input
                id="lot-output-cost"
                inputMode="decimal"
                value={unitCost}
                onChange={(event) => {
                  setUnitCost(event.target.value);
                  setPlan(null);
                }}
              />
            </FormField>
            <FormField label="Nota" htmlFor="lot-output-reason">
              <Input
                id="lot-output-reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setPlan(null);
                }}
              />
            </FormField>
          </div>

          <div className="mt-4">
            <Button
              variant="secondary"
              onClick={() => planMutation.mutate()}
              disabled={!quantityValid || !costValid || planMutation.isPending}
            >
              {planMutation.isPending ? 'Calculando…' : 'Previsualizar'}
            </Button>
          </div>

          {plan && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm font-bold text-slate-800">Se descontará de estos lotes</p>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {plan.map((allocation) => (
                  <li key={allocation.lot_id}>
                    {allocation.lot_number} — {formatQuantity(allocation.quantity)}
                    {allocation.expiration_date ? ` · caduca ${allocation.expiration_date}` : ''}
                  </li>
                ))}
              </ul>
              <Button
                variant="danger"
                className="mt-4"
                disabled={consumeMutation.isPending}
                onClick={() => {
                  const payload: FefoConsumeInput = {
                    warehouse_id: Number(warehouseId),
                    location_id: Number(locationId),
                    quantity,
                    movement_type: movementType,
                    unit_cost: unitCost,
                    reason,
                  };
                  const fingerprint = JSON.stringify({ productId, payload });
                  const previous = consumeAttemptRef.current;
                  const attempt =
                    previous?.fingerprint === fingerprint
                      ? previous
                      : { fingerprint, key: crypto.randomUUID() };
                  consumeAttemptRef.current = attempt;
                  consumeMutation.mutate({ payload, key: attempt.key });
                }}
              >
                {consumeMutation.isPending ? 'Registrando…' : 'Confirmar salida'}
              </Button>
            </div>
          )}

          {error && (
            <div className="mt-4">
              <Alert tone="error">{error}</Alert>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
