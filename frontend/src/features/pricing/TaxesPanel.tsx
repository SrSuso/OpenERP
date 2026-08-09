import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { createTax, taxesQuery, updateTax, type Tax } from '@/features/pricing/api';
import { ApiError } from '@/lib/api';
import { decimalString } from '@/lib/decimal';
import { formatRate } from '@/lib/format';

/** El catálogo de impuestos en sí — nombre + tasa, editable en la propia
 * fila (al estilo de la lista de impuestos de Odoo, sin un formulario
 * aparte para cambiar algo que ya existe). Se asignan a productos y/o
 * categorías desde sus propias pantallas (Catálogo → Productos/
 * Categorías) con `TaxChips`; varios pueden aplicar a la vez sobre el
 * mismo producto. */
export function TaxesPanel({ canManage }: { canManage: boolean }) {
  const taxes = useQuery(taxesQuery);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createTax(name.trim(), decimalString({ min: 0 }).parse(rate)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taxesQuery.queryKey });
      setName('');
      setRate('');
      setError(null);
    },
    onError: (err: unknown) => {
      setError(
        err instanceof ApiError && err.code === 'conflict'
          ? 'Ya existe un impuesto con ese nombre.'
          : 'No se ha podido crear el impuesto — revisa la tasa.',
      );
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !rate.trim()) return;
    createMutation.mutate();
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Impuestos</h3>

      {taxes.isPending && <p className="text-sm text-slate-500">Cargando…</p>}

      <ul className="mb-4 flex flex-col gap-1.5">
        {taxes.data?.map((tax) =>
          editingId === tax.id ? (
            <EditTaxRow key={tax.id} tax={tax} onDone={() => setEditingId(null)} />
          ) : (
            <li
              key={tax.id}
              className="flex items-center justify-between rounded border border-slate-200 px-3 py-1.5 text-sm"
            >
              <span>{tax.name}</span>
              <span className="flex items-center gap-3">
                <span className="text-slate-500">{formatRate(tax.rate)}%</span>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setEditingId(tax.id)}
                    className="text-xs font-medium text-brand-700 hover:underline"
                  >
                    Editar
                  </button>
                )}
              </span>
            </li>
          ),
        )}
        {taxes.data?.length === 0 && (
          <p className="text-sm text-slate-500">Todavía no hay ninguno.</p>
        )}
      </ul>

      {canManage && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">
            Nombre
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="IVA general"
              className="mt-1 block w-40 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Tasa (%)
            <input
              type="text"
              inputMode="decimal"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
              placeholder="21"
              className="mt-1 block w-24 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded bg-brand-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Añadir
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

function EditTaxRow({ tax, onDone }: { tax: Tax; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(tax.name);
  const [rate, setRate] = useState(tax.rate);
  const [error, setError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: () => {
      const parsedRate = decimalString({ min: 0 }).safeParse(rate);
      if (!parsedRate.success) {
        throw new Error(parsedRate.error.issues[0]?.message ?? 'Tasa no válida.');
      }
      return updateTax(tax.id, { name: name.trim(), rate: parsedRate.data });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taxesQuery.queryKey });
      onDone();
    },
    onError: (err: unknown) => {
      setError(
        err instanceof ApiError && err.code === 'conflict'
          ? 'Ya existe un impuesto con ese nombre.'
          : err instanceof Error
            ? err.message
            : 'No se ha podido guardar.',
      );
    },
  });

  return (
    <li className="rounded border border-brand-200 bg-brand-50/40 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">
          Nombre
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 block w-40 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-slate-600">
          Tasa (%)
          <input
            type="text"
            inputMode="decimal"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            className="mt-1 block w-24 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="rounded bg-brand-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancelar
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </li>
  );
}
