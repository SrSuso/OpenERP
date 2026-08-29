import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

import { warehousesQuery } from '@/features/inventory/api';
import { useAuth } from '@/features/auth/useAuth';
import {
  createPosTerminal,
  posTerminalsQuery,
  updatePosTerminal,
  type PosTerminal,
} from '@/features/pos/api';
import {
  POS_TERMINAL_SETTING_KEYS,
  QZ_PRINT_SETTING_KEYS,
  SettingsOptionsPanel,
} from '@/features/settings/SettingsOptionsPanel';
import { ColdDrinkSurchargePanel } from '@/features/settings/ColdDrinkSurchargePanel';
import { useSettledQzPrintConfig } from '@/features/tickets/qzConfig';
import { testQzPrinterConnection } from '@/features/tickets/qzPrinter';

function QzConnectionTest() {
  const config = useSettledQzPrintConfig();
  const test = useMutation({
    mutationFn: async () => {
      if (config === undefined) throw new Error('La configuración todavía no está disponible.');
      return testQzPrinterConnection(config);
    },
  });

  return (
    <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
      <button
        type="button"
        disabled={config === undefined || test.isPending}
        onClick={() => test.mutate()}
        className="rounded border border-brand-700 px-4 py-2 text-sm font-medium text-brand-700 disabled:opacity-40"
      >
        {test.isPending ? 'Comprobando QZ… (máx. 12 s)' : 'Probar conexión e impresora guardadas'}
      </button>
      {test.isSuccess && (
        <p role="status" className="mt-2 text-sm font-medium text-green-700">
          Conexión correcta. QZ encuentra «{test.data.printerName}». Firma silenciosa:{' '}
          {test.data.signingEnabled ? 'activa' : 'no configurada'}.
        </p>
      )}
      {test.isError && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {test.error instanceof Error ? test.error.message : 'No se ha podido conectar con QZ.'}
        </p>
      )}
      <p className="mt-2 text-xs text-slate-500">
        La prueba utiliza los valores ya guardados. Guarda cualquier cambio antes de probar. Si QZ
        muestra una autorización, respóndela: la comprobación caduca con un diagnóstico a los 12 s.
      </p>
    </div>
  );
}

function TerminalRow({ terminal }: { terminal: PosTerminal }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(terminal.name);
  const update = useMutation({
    mutationFn: (changes: { name?: string; is_active?: boolean; show_product_search?: boolean }) =>
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
      <td className="px-4 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            aria-label={`Buscador táctil de ${terminal.name}`}
            checked={terminal.show_product_search}
            disabled={update.isPending}
            onChange={(event) => update.mutate({ show_product_search: event.target.checked })}
          />
          Buscar productos
        </label>
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
  const { hasPermission } = useAuth();
  const canManageTerminals = hasPermission('pos_terminal.manage');
  const canManageColdDrinkSurcharge = hasPermission('pos.cold_drink_surcharge.manage');
  const queryClient = useQueryClient();
  const terminals = useQuery({ ...posTerminalsQuery(false), enabled: canManageTerminals });
  const warehouses = useQuery({ ...warehousesQuery, enabled: canManageTerminals });
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
      {canManageTerminals && (
        <>
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
                  <th className="px-4 py-2 font-medium">Buscador táctil</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {(terminals.data ?? []).map((terminal) => (
                  <TerminalRow key={terminal.id} terminal={terminal} />
                ))}
                {terminals.data?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-3 text-slate-500">
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
        </>
      )}

      {canManageColdDrinkSurcharge && (
        <section className="border-t border-slate-200 pt-6">
          <h2 className="text-lg font-semibold text-slate-900">Bebidas frías</h2>
          <p className="mb-4 mt-1 text-sm text-slate-600">
            Este importe se suma por unidad al seleccionar «Bebida fría» antes de añadir un artículo
            en el TPV.
          </p>
          <ColdDrinkSurchargePanel />
        </section>
      )}

      {hasPermission('settings.read') && (
        <>
          <section className="border-t border-slate-200 pt-6">
            <h2 className="text-lg font-semibold text-slate-900">Impresión mediante QZ Tray</h2>
            <p className="mb-4 mt-1 text-sm text-slate-600">
              Indica el PC Windows que controla la impresora. La misma configuración se utiliza
              desde el TPV, Ventas, Devoluciones y Cierres Z.
            </p>
            <SettingsOptionsPanel
              canManage={hasPermission('settings.manage')}
              includeKeys={QZ_PRINT_SETTING_KEYS}
            />
            <QzConnectionTest />
          </section>

          <section className="border-t border-slate-200 pt-6">
            <h2 className="text-lg font-semibold text-slate-900">Pantalla y botones del TPV</h2>
            <p className="mb-4 mt-1 text-sm text-slate-600">
              Estos ajustes se aplican a todas las cajas de la tienda. El buscador táctil se activa
              individualmente en cada terminal, en la tabla de arriba.
            </p>
            <SettingsOptionsPanel
              canManage={hasPermission('settings.manage')}
              includeKeys={POS_TERMINAL_SETTING_KEYS}
            />
          </section>
        </>
      )}
    </div>
  );
}
