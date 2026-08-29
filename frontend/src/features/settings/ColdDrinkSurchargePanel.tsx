import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { SettingField } from '@/features/settings/SettingField';
import {
  coldDrinkSurchargeQuery,
  settingsValuesQuery,
  updateColdDrinkSurcharge,
} from '@/features/settings/optionsApi';
import { ApiError } from '@/lib/api';

/** El permiso ``pos.cold_drink_surcharge.manage`` da acceso únicamente a
 * esta tarjeta. No usa la API del catálogo general de ajustes. */
export function ColdDrinkSurchargePanel() {
  const queryClient = useQueryClient();
  const setting = useQuery(coldDrinkSurchargeQuery);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const value = draft ?? setting.data?.value ?? '';
  const isDirty = setting.data !== undefined && value !== setting.data.value;
  const save = useMutation({
    mutationFn: () => updateColdDrinkSurcharge(value.trim().replace(',', '.')),
    onSuccess: (updated) => {
      queryClient.setQueryData(coldDrinkSurchargeQuery.queryKey, updated);
      queryClient.setQueryData<Record<string, string> | undefined>(
        settingsValuesQuery.queryKey,
        (current) => ({ ...current, [updated.key]: updated.value }),
      );
      setDraft(null);
      setError(null);
      setSaved(true);
    },
    onError: (reason: unknown) => {
      setSaved(false);
      setError(reason instanceof ApiError ? reason.message : 'No se ha podido guardar el importe.');
    },
  });

  if (setting.isPending) return <p className="text-sm text-slate-500">Cargando el importe…</p>;
  if (setting.isError || !setting.data) {
    return <p className="text-sm text-red-600">No se ha podido cargar el importe de bebida fría.</p>;
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <SettingField
        definition={setting.data}
        value={value}
        isDirty={isDirty}
        disabled={save.isPending}
        onChange={(next) => {
          setDraft(next);
          setError(null);
          setSaved(false);
        }}
      />
      {error && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={!isDirty || save.isPending}
          onClick={() => save.mutate()}
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50 disabled:hover:bg-brand-700"
        >
          {save.isPending ? 'Guardando…' : 'Guardar importe'}
        </button>
        {isDirty && !save.isPending && (
          <span className="text-sm text-amber-800">1 cambio pendiente</span>
        )}
        {saved && !isDirty && (
          <span className="text-sm font-medium text-green-700">
            Guardado. Ya está aplicado en la caja.
          </span>
        )}
      </div>
    </section>
  );
}
