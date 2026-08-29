import { useState } from 'react';

import { type Lot, type LotUpdateInput } from '@/features/lots/api';
import { type Supplier } from '@/features/suppliers/api';

/** Lotes de un producto, en el mismo orden FEFO (caducidad más próxima
 * primero, sin fecha al final) en que el backend los consumiría — ver
 * backend/app/lots/service.py's `plan_fefo`. */
interface LotsTableProps {
  lots: Lot[];
  suppliers: Supplier[];
  canManage: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  actionError: string | null;
  onSave: (lotId: number, payload: LotUpdateInput) => Promise<unknown>;
  onDelete: (lot: Lot) => void;
}

function EditLotRow({
  lot,
  suppliers,
  isSaving,
  onCancel,
  onSave,
}: {
  lot: Lot;
  suppliers: Supplier[];
  isSaving: boolean;
  onCancel: () => void;
  onSave: (payload: LotUpdateInput) => Promise<unknown>;
}) {
  const [values, setValues] = useState<LotUpdateInput>({
    lot_number: lot.lot_number,
    manufacturing_date: lot.manufacturing_date,
    expiration_date: lot.expiration_date,
    supplier_id: lot.supplier_id,
  });

  return (
    <tr className="border-b border-slate-100 bg-brand-50/40 last:border-0">
      <td className="px-4 py-2">
        <label className="sr-only" htmlFor={`lot-number-${lot.id}`}>
          Nº de lote
        </label>
        <input
          id={`lot-number-${lot.id}`}
          value={values.lot_number}
          onChange={(event) =>
            setValues((current) => ({ ...current, lot_number: event.target.value }))
          }
          className="w-32 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </td>
      <td className="px-4 py-2">
        <label className="sr-only" htmlFor={`lot-manufacturing-${lot.id}`}>
          Fabricación
        </label>
        <input
          id={`lot-manufacturing-${lot.id}`}
          type="date"
          value={values.manufacturing_date ?? ''}
          onChange={(event) =>
            setValues((current) => ({
              ...current,
              manufacturing_date: event.target.value || null,
            }))
          }
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </td>
      <td className="px-4 py-2">
        <label className="sr-only" htmlFor={`lot-expiration-${lot.id}`}>
          Caducidad
        </label>
        <input
          id={`lot-expiration-${lot.id}`}
          type="date"
          value={values.expiration_date ?? ''}
          onChange={(event) =>
            setValues((current) => ({ ...current, expiration_date: event.target.value || null }))
          }
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </td>
      <td className="px-4 py-2">
        <label className="sr-only" htmlFor={`lot-supplier-${lot.id}`}>
          Proveedor
        </label>
        <select
          id={`lot-supplier-${lot.id}`}
          value={values.supplier_id ?? ''}
          onChange={(event) =>
            setValues((current) => ({
              ...current,
              supplier_id: event.target.value === '' ? null : Number(event.target.value),
            }))
          }
          className="w-40 rounded border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">Sin proveedor</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-right">
        <button
          type="button"
          onClick={() => {
            void onSave(values)
              .then(() => onCancel())
              .catch(() => undefined);
          }}
          disabled={isSaving || values.lot_number.trim() === ''}
          className="rounded bg-brand-700 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
        >
          {isSaving ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="ml-2 rounded px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          Cancelar
        </button>
      </td>
    </tr>
  );
}

export function LotsTable({
  lots,
  suppliers,
  canManage,
  isSaving,
  isDeleting,
  actionError,
  onSave,
  onDelete,
}: LotsTableProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  if (lots.length === 0) {
    return <p className="text-sm text-slate-500">Este producto todavía no tiene lotes.</p>;
  }

  const sorted = [...lots].sort((a, b) => {
    if (a.expiration_date === null) return 1;
    if (b.expiration_date === null) return -1;
    return a.expiration_date.localeCompare(b.expiration_date);
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Lote</th>
            <th className="px-4 py-2 font-medium">Fabricación</th>
            <th className="px-4 py-2 font-medium">Caducidad</th>
            <th className="px-4 py-2 font-medium">Proveedor</th>
            {canManage && <th className="px-4 py-2 text-right font-medium">Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((lot) =>
            editingId === lot.id ? (
              <EditLotRow
                key={lot.id}
                lot={lot}
                suppliers={suppliers}
                isSaving={isSaving}
                onCancel={() => setEditingId(null)}
                onSave={(payload) => onSave(lot.id, payload)}
              />
            ) : (
              <tr key={lot.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2 font-medium text-slate-800">{lot.lot_number}</td>
                <td className="px-4 py-2">{lot.manufacturing_date ?? '—'}</td>
                <td className="px-4 py-2">{lot.expiration_date ?? '—'}</td>
                <td className="px-4 py-2">
                  {suppliers.find((supplier) => supplier.id === lot.supplier_id)?.name ?? '—'}
                </td>
                {canManage && (
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setEditingId(lot.id)}
                      disabled={isDeleting}
                      className="rounded px-2 py-1 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(lot)}
                      disabled={isDeleting}
                      className="ml-1 rounded px-2 py-1 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      {isDeleting ? 'Eliminando…' : 'Eliminar'}
                    </button>
                  </td>
                )}
              </tr>
            ),
          )}
        </tbody>
      </table>
      {actionError && (
        <p className="border-t border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}
    </div>
  );
}
