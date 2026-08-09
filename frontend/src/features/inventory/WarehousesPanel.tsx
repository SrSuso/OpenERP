import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState, type FormEvent } from 'react';

import { LocationsPanel } from '@/features/inventory/LocationsPanel';
import { createWarehouse, warehousesQuery } from '@/features/inventory/api';

/** Almacenes y, por cada uno, sus ubicaciones (fila expandible) — lo que
 * alimenta los desplegables de almacén/ubicación en ajustes, transferencias
 * y recepciones de mercancía. */
export function WarehousesPanel({ canManage }: { canManage: boolean }) {
  const warehouses = useQuery(warehousesQuery);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const createMutation = useMutation({
    mutationFn: (value: string) => createWarehouse(value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: warehousesQuery.queryKey });
      setName('');
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate(name.trim());
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Almacén</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {(warehouses.data ?? []).map((warehouse) => (
            <Fragment key={warehouse.id}>
              <tr className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2 font-medium text-slate-800">{warehouse.name}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId((current) => (current === warehouse.id ? null : warehouse.id))
                    }
                    className="text-sm font-medium text-slate-600 hover:underline"
                  >
                    {expandedId === warehouse.id ? 'Ocultar' : 'Ubicaciones'}
                  </button>
                </td>
              </tr>
              {expandedId === warehouse.id && (
                <tr>
                  <td colSpan={2} className="p-0">
                    <LocationsPanel warehouseId={warehouse.id} canManage={canManage} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {warehouses.data && warehouses.data.length === 0 && (
            <tr>
              <td colSpan={2} className="px-4 py-2 text-sm text-slate-500">
                Todavía no hay almacenes.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canManage && (
        <form onSubmit={submit} className="flex gap-2 border-t border-slate-200 p-4">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Almacén central…"
            className="w-48 rounded border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded bg-brand-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Añadir almacén
          </button>
        </form>
      )}
    </div>
  );
}
