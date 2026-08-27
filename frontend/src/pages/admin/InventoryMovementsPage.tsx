import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { productsQuery } from '@/features/catalog/api';
import { StockMovementsTable } from '@/features/inventory/StockMovementsTable';
import { stockMovementsQuery, warehousesQuery } from '@/features/inventory/api';

export function InventoryMovementsPage() {
  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');

  const products = useQuery(productsQuery({ activeOnly: true }));
  const warehouses = useQuery(warehousesQuery);
  const movements = useQuery(
    stockMovementsQuery({
      ...(productId !== '' ? { productId: Number(productId) } : {}),
      ...(warehouseId !== '' ? { warehouseId: Number(warehouseId) } : {}),
    }),
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm text-slate-600">
          Producto
          <select
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            className="mt-1 block w-48 rounded border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="">Todos</option>
            {(products.data ?? []).map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm text-slate-600">
          Almacén
          <select
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
            className="mt-1 block rounded border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="">Todos</option>
            {(warehouses.data ?? []).map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {movements.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {movements.isError && (
        <p className="text-sm text-red-600">No se han podido cargar los movimientos.</p>
      )}
      {movements.data && <StockMovementsTable movements={movements.data} />}
    </div>
  );
}
