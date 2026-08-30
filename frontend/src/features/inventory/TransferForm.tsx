import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { type Product } from '@/features/catalog/api';
import { useChosenProduct } from '@/features/catalog/useChosenProduct';
import { useProductSearch } from '@/features/catalog/useProductSearch';
import { locationsQuery, warehousesQuery } from '@/features/inventory/api';
import { useDefaultToFirstOption } from '@/features/inventory/useDefaultToFirstOption';
import { decimalInputValue, decimalString } from '@/lib/decimal';

const transferSchema = z.object({
  product_id: z.string().min(1, 'Elige un producto.'),
  from_warehouse_id: z.string().min(1, 'Elige un almacén de origen.'),
  from_location_id: z.string().min(1, 'Elige una ubicación de origen.'),
  to_warehouse_id: z.string().min(1, 'Elige un almacén de destino.'),
  to_location_id: z.string().min(1, 'Elige una ubicación de destino.'),
  quantity: decimalString({ min: 0.000001 }),
  unit_cost: decimalString({ min: 0 }),
  lot_id: z.string().optional(),
});

type TransferFormValues = z.infer<typeof transferSchema>;

interface TransferFormProps {
  products: Product[];
  onSubmit: (payload: {
    product_id: number;
    from_warehouse_id: number;
    from_location_id: number;
    to_warehouse_id: number;
    to_location_id: number;
    quantity: string;
    unit_cost: string;
    lot_id: number | null;
  }) => void;
  isPending: boolean;
  submitError: string | null;
}

export function TransferForm({ products, onSubmit, isPending, submitError }: TransferFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<TransferFormValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: { unit_cost: '0' },
  });

  const productId = watch('product_id');
  const chosenProduct = useChosenProduct(productId, products, (product) =>
    setValue('unit_cost', decimalInputValue(product.cost)),
  );
  const productFieldId = useId();
  const { query, setQuery, matches } = useProductSearch(products);
  const fromWarehouseId = watch('from_warehouse_id');
  const toWarehouseId = watch('to_warehouse_id');
  const fromLocationId = watch('from_location_id');
  const toLocationId = watch('to_location_id');
  const warehouses = useQuery(warehousesQuery);
  const fromLocations = useQuery(locationsQuery(fromWarehouseId ? Number(fromWarehouseId) : null));
  const toLocations = useQuery(locationsQuery(toWarehouseId ? Number(toWarehouseId) : null));

  useDefaultToFirstOption(fromWarehouseId, warehouses.data, (value) =>
    setValue('from_warehouse_id', value),
  );
  useDefaultToFirstOption(toWarehouseId, warehouses.data, (value) =>
    setValue('to_warehouse_id', value),
  );
  useDefaultToFirstOption(fromLocationId, fromLocations.data, (value) =>
    setValue('from_location_id', value),
  );
  useDefaultToFirstOption(toLocationId, toLocations.data, (value) =>
    setValue('to_location_id', value),
  );

  const submit = handleSubmit((values) =>
    onSubmit({
      product_id: Number(values.product_id),
      from_warehouse_id: Number(values.from_warehouse_id),
      from_location_id: Number(values.from_location_id),
      to_warehouse_id: Number(values.to_warehouse_id),
      to_location_id: Number(values.to_location_id),
      quantity: values.quantity,
      unit_cost: values.unit_cost,
      lot_id: values.lot_id ? Number(values.lot_id) : null,
    }),
  );

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Registrar transferencia</h3>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="relative text-sm text-slate-600">
          <label htmlFor={productFieldId}>Producto</label>
          <input
            id={productFieldId}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setValue('product_id', '', { shouldValidate: true });
            }}
            placeholder="Nombre o código de barras…"
            aria-label="Buscar producto"
            autoComplete="off"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
          />
          <input type="hidden" {...register('product_id')} />
          {productId === '' && query.trim() !== '' && (
            <div
              role="listbox"
              aria-label="Resultados de producto"
              className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded border border-slate-300 bg-white py-1 shadow-lg"
            >
              {matches.slice(0, 8).map((product) => (
                <button
                  key={product.id}
                  type="button"
                  role="option"
                  aria-label={`Seleccionar ${product.name}`}
                  onClick={() => {
                    setValue('product_id', String(product.id), { shouldValidate: true });
                    setQuery(product.name);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-brand-50"
                >
                  {product.name}
                </button>
              ))}
              {matches.length === 0 && (
                <p className="px-3 py-2 text-sm text-slate-500">No hay productos coincidentes.</p>
              )}
            </div>
          )}
          {productId !== '' && (
            <button
              type="button"
              onClick={() => {
                setValue('product_id', '', { shouldValidate: true });
                setQuery('');
              }}
              className="mt-1 text-xs font-medium text-brand-700 hover:text-brand-900"
            >
              Elegir otro producto
            </button>
          )}
          {errors.product_id && (
            <p className="mt-1 text-sm text-red-600">{errors.product_id.message}</p>
          )}
        </div>

        <label className="text-sm text-slate-600">
          Cantidad
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
            con lo que se vende. No entra en la transferencia (que se valora
            al coste): para cambiarlo está la lista de productos. */}
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

        <label className="text-sm text-slate-600">
          Almacén origen
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('from_warehouse_id')}
          >
            <option value="">Elige…</option>
            {(warehouses.data ?? []).map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
          {errors.from_warehouse_id && (
            <p className="mt-1 text-sm text-red-600">{errors.from_warehouse_id.message}</p>
          )}
        </label>

        <label className="text-sm text-slate-600">
          Ubicación origen
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('from_location_id')}
          >
            <option value="">Elige…</option>
            {(fromLocations.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          {errors.from_location_id && (
            <p className="mt-1 text-sm text-red-600">{errors.from_location_id.message}</p>
          )}
        </label>

        <label className="text-sm text-slate-600">
          Lote (opcional, ID)
          <input
            type="text"
            inputMode="numeric"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('lot_id')}
          />
        </label>

        <label className="text-sm text-slate-600">
          Almacén destino
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('to_warehouse_id')}
          >
            <option value="">Elige…</option>
            {(warehouses.data ?? []).map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
          {errors.to_warehouse_id && (
            <p className="mt-1 text-sm text-red-600">{errors.to_warehouse_id.message}</p>
          )}
        </label>

        <label className="text-sm text-slate-600">
          Ubicación destino
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('to_location_id')}
          >
            <option value="">Elige…</option>
            {(toLocations.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          {errors.to_location_id && (
            <p className="mt-1 text-sm text-red-600">{errors.to_location_id.message}</p>
          )}
        </label>
      </div>

      {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}

      <div className="mt-4">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? 'Registrando…' : 'Registrar transferencia'}
        </button>
      </div>
    </form>
  );
}
