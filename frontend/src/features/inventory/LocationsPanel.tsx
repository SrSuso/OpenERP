import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { createLocation, locationsQuery } from '@/features/inventory/api';

interface LocationsPanelProps {
  warehouseId: number;
  canManage: boolean;
}

/** Ubicaciones de un almacén — fila expandida de `WarehousesPanel`. */
export function LocationsPanel({ warehouseId, canManage }: LocationsPanelProps) {
  const locations = useQuery(locationsQuery(warehouseId));
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const createMutation = useMutation({
    mutationFn: (value: string) => createLocation(warehouseId, value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inventory', 'locations', warehouseId] });
      setName('');
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate(name.trim());
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50 p-4">
      {locations.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      <ul className="mb-2 flex flex-wrap gap-1.5">
        {(locations.data ?? []).map((location) => (
          <li
            key={location.id}
            className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600"
          >
            {location.name}
          </li>
        ))}
        {locations.data && locations.data.length === 0 && (
          <p className="text-sm text-slate-500">Este almacén todavía no tiene ubicaciones.</p>
        )}
      </ul>

      {canManage && (
        <form onSubmit={submit} className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Recepción, Pasillo 1…"
            className="w-40 rounded border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded bg-slate-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Añadir ubicación
          </button>
        </form>
      )}
    </div>
  );
}
