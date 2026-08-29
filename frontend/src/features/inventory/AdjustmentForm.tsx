import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { type Product } from '@/features/catalog/api';
import { useChosenProduct } from '@/features/catalog/useChosenProduct';
import { useProductSearch } from '@/features/catalog/useProductSearch';
import { locationsQuery, warehousesQuery } from '@/features/inventory/api';
import { useDefaultToFirstOption } from '@/features/inventory/useDefaultToFirstOption';
import { decimalInputValue, decimalString } from '@/lib/decimal';

const adjustmentSchema = z.object({
  product_id: z.string().min(1, 'Elige un producto.'),
  warehouse_id: z.string().min(1, 'Elige un almacén.'),
  location_id: z.string().min(1, 'Elige una ubicación.'),
  movement_type: z.enum(['ADJUSTMENT', 'WASTE']),
  // Con signo para ADJUSTMENT (puede sumar o restar); WASTE siempre resta
  // — el backend lo normaliza si se manda en positivo (rule ver AdjustmentCreate).
  quantity: z
    .string()
    .trim()
    .transform((value) => value.replace(',', '.'))
    .refine((value) => /^-?\d+(\.\d{1,6})?$/.test(value) && Number(value) !== 0, {
      message: 'Introduce una cantidad distinta de cero.',
    }),
  unit_cost: decimalString({ min: 0 }),
  lot_number: z.string().max(100).optional(),
  expiration_date: z.string().optional(),
  reason: z.string().max(500).optional(),
});

type AdjustmentFormValues = z.infer<typeof adjustmentSchema>;

interface AdjustmentFormProps {
  products: Product[];
  onSubmit: (payload: {
    product_id: number;
    warehouse_id: number;
    location_id: number;
    movement_type: 'ADJUSTMENT' | 'WASTE';
    quantity: string;
    unit_cost: string;
    lot_id: number | null;
    lot_number: string | null;
    expiration_date: string | null;
    reason: string;
  }) => void;
  isPending: boolean;
  submitError: string | null;
}

/** Ajuste manual de stock (recuento, rotura…) — mismo endpoint tanto para
 * `ADJUSTMENT` (con signo) como `WASTE` (siempre una pérdida). */
export function AdjustmentForm({
  products,
  onSubmit,
  isPending,
  submitError,
}: AdjustmentFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm<AdjustmentFormValues>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: { movement_type: 'ADJUSTMENT', unit_cost: '0' },
  });

  const warehouseId = watch('warehouse_id');
  const locationId = watch('location_id');
  const productId = watch('product_id');
  const chosenProduct = useChosenProduct(productId, products, (product) =>
    setValue('unit_cost', decimalInputValue(product.cost)),
  );
  const productFieldId = useId();
  const { query, setQuery, matches } = useProductSearch(products);
  const warehouses = useQuery(warehousesQuery);
  const locations = useQuery(locationsQuery(warehouseId ? Number(warehouseId) : null));

  useDefaultToFirstOption(warehouseId, warehouses.data, (value) => setValue('warehouse_id', value));
  useDefaultToFirstOption(locationId, locations.data, (value) => setValue('location_id', value));

  useEffect(() => {
    setValue('lot_number', '');
    setValue('expiration_date', '');
  }, [productId, setValue]);

  const submit = handleSubmit((values) => {
    const lotNumber = values.lot_number?.trim() ?? '';
    if (chosenProduct?.track_lots && lotNumber === '') {
      setError('lot_number', { message: 'Introduce el lote que figura en el envase.' });
      return;
    }
    if (chosenProduct?.track_expiration && !values.expiration_date) {
      setError('expiration_date', { message: 'Introduce la fecha de caducidad.' });
      return;
    }
    onSubmit({
      product_id: Number(values.product_id),
      warehouse_id: Number(values.warehouse_id),
      location_id: Number(values.location_id),
      movement_type: values.movement_type,
      quantity: values.quantity,
      unit_cost: values.unit_cost,
      lot_id: null,
      lot_number: lotNumber === '' ? null : lotNumber,
      expiration_date: values.expiration_date || null,
      reason: values.reason ?? '',
    });
  });

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Registrar ajuste</h3>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="text-sm text-slate-600">
          <label htmlFor={productFieldId}>Producto</label>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nombre o código de barras…"
            aria-label="Buscar producto"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
          />
          <select
            id={productFieldId}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('product_id')}
          >
            <option value="">Elige un producto…</option>
            {matches.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          {errors.product_id && (
            <p className="mt-1 text-sm text-red-600">{errors.product_id.message}</p>
          )}
        </div>

        <label className="text-sm text-slate-600">
          Almacén
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('warehouse_id')}
          >
            <option value="">Elige un almacén…</option>
            {(warehouses.data ?? []).map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
          {errors.warehouse_id && (
            <p className="mt-1 text-sm text-red-600">{errors.warehouse_id.message}</p>
          )}
        </label>

        <label className="text-sm text-slate-600">
          Ubicación
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('location_id')}
          >
            <option value="">Elige una ubicación…</option>
            {(locations.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          {errors.location_id && (
            <p className="mt-1 text-sm text-red-600">{errors.location_id.message}</p>
          )}
        </label>

        <label className="text-sm text-slate-600">
          Tipo
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('movement_type')}
          >
            <option value="ADJUSTMENT">Ajuste (recuento)</option>
            <option value="WASTE">Merma</option>
          </select>
        </label>

        <label className="text-sm text-slate-600">
          Cantidad (con signo)
          <input
            type="text"
            inputMode="decimal"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('quantity')}
          />
          {errors.quantity && (
            <p className="mt-1 text-sm text-red-600">{errors.quantity.message}</p>
          )}
        </label>

        <label className="text-sm text-slate-600">
          Coste/ud.
          <input
            type="text"
            inputMode="decimal"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('unit_cost')}
          />
          {errors.unit_cost && (
            <p className="mt-1 text-sm text-red-600">{errors.unit_cost.message}</p>
          )}
        </label>

        {/* Al lado del coste para poder comparar de un vistazo lo que cuesta
            con lo que se vende. No entra en el ajuste (que se valora al
            coste): para cambiarlo está la lista de productos. */}
        <label className="text-sm text-slate-600">
          PVP/ud.
          <input
            type="text"
            readOnly
            value={chosenProduct ? decimalInputValue(chosenProduct.list_price) : ''}
            placeholder="—"
            className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
          />
        </label>

        {chosenProduct?.track_lots && (
          <>
            <label className="text-sm text-slate-600">
              Lote
              <input
                type="text"
                aria-label="Número de lote"
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                placeholder="El número impreso en el envase"
                {...register('lot_number')}
              />
              {errors.lot_number && (
                <p className="mt-1 text-sm text-red-600">{errors.lot_number.message}</p>
              )}
              <p className="mt-1 text-xs text-slate-400">
                Si no existe, se crea al registrar este ajuste.
              </p>
            </label>

            {chosenProduct.track_expiration && (
              <label className="text-sm text-slate-600">
                Caducidad
                <input
                  type="date"
                  aria-label="Fecha de caducidad"
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  {...register('expiration_date')}
                />
                {errors.expiration_date && (
                  <p className="mt-1 text-sm text-red-600">{errors.expiration_date.message}</p>
                )}
              </label>
            )}
          </>
        )}

        <label className="text-sm text-slate-600 sm:col-span-2">
          Motivo (opcional)
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('reason')}
          />
        </label>
      </div>

      {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}

      <div className="mt-4">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? 'Registrando…' : 'Registrar ajuste'}
        </button>
      </div>
    </form>
  );
}
