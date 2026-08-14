import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

import { warehousesQuery } from '@/features/inventory/api';
import {
  createPosTerminal,
  posTerminalsQuery,
  updatePosTerminal,
  type PosTerminal,
} from '@/features/pos/api';

function TerminalRow({ terminal }: { terminal: PosTerminal }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(terminal.name);
  const update = useMutation({
    mutationFn: (changes: { name?: string; is_active?: boolean }) =>
      updatePosTerminal(terminal.id, changes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pos', 'terminals'] });
    },
  });

  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-4 py-2">
        <input
          aria-label={`Nombre de ${terminal.name}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1"
        />
      </td>
      <td className="px-4 py-2 text-slate-600">{terminal.warehouse_name}</td>
      <td className="px-4 py-2">
        <span className={terminal.is_active ? 'text-green-700' : 'text-slate-500'}>
          {terminal.is_active ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td className="px-4 py-2 text-right">
        <div className="flex justify-end gap-3">
          <button
            type="button"
            disabled={update.isPending || name.trim() === '' || name.trim() === terminal.name}
            onClick={() => update.mutate({ name: name.trim() })}
            className="font-medium text-brand-700 hover:underline disabled:opacity-40"
          >
            Guardar nombre
          </button>
          <button
            type="button"
            disabled={update.isPending}
            onClick={() => update.mutate({ is_active: !terminal.is_active })}
            className="font-medium text-slate-700 hover:underline disabled:opacity-40"
          >
            {terminal.is_active ? 'Desactivar' : 'Activar'}
          </button>
        </div>
      </td>
    </tr>
  );
}

/** Minimal registry only: no shifts, sessions, till balances or peripherals. */
export function PosTerminalsPage() {
  const queryClient = useQueryClient();
  const terminals = useQuery(posTerminalsQuery(false));
  const warehouses = useQuery(warehousesQuery);
  const [name, setName] = useState('');
  const [warehouseId, setWarehouseId] = useState('');

  useEffect(() => {
    if (warehouseId === '' && warehouses.data?.[0]) {
      setWarehouseId(String(warehouses.data[0].id));
    }
  }, [warehouseId, warehouses.data]);

  const create = useMutation({
    mutationFn: () => createPosTerminal(name.trim(), Number(warehouseId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pos', 'terminals'] });
      setName('');
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === '' || warehouseId === '') return;
    create.mutate();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Cada navegador elige una de estas cajas. El almacén queda fijado al crearla para no
        reinterpretar sus ventas históricas.
      </p>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Terminal</th>
              <th className="px-4 py-2 font-medium">Almacén</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {(terminals.data ?? []).map((terminal) => (
              <TerminalRow key={terminal.id} terminal={terminal} />
            ))}
            {terminals.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-slate-500">
                  Todavía no hay terminales POS.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded border p-4">
        <label className="text-sm text-slate-600">
          Nombre
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Caja 1"
            className="mt-1 block rounded border border-slate-300 px-3 py-1.5"
          />
        </label>
        <label className="text-sm text-slate-600">
          Almacén
          <select
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
            className="mt-1 block rounded border border-slate-300 px-3 py-1.5"
          >
            {(warehouses.data ?? []).map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={create.isPending || name.trim() === '' || warehouseId === ''}
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Añadir terminal
        </button>
      </form>
    </div>
  );
}
