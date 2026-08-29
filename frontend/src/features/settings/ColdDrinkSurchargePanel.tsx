import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { SettingField } from '@/features/settings/SettingField';
import {
  posSurchargesQuery,
  settingsValuesQuery,
  updatePosSurcharges,
} from '@/features/settings/optionsApi';
import { ApiError } from '@/lib/api';

/** The delegated POS-surcharge permission deliberately exposes only these
 * four amounts, never the broad functional settings catalogue. */
export function ColdDrinkSurchargePanel() {
  const queryClient = useQueryClient();
  const surcharges = useQuery(posSurchargesQuery);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const changed = (surcharges.data?.settings ?? []).filter(
    (setting) => draft[setting.key] !== undefined && draft[setting.key] !== setting.value,
  );
  const save = useMutation({
    mutationFn: () =>
      updatePosSurcharges(
        Object.fromEntries(
          changed.map((setting) => [
            setting.key,
            (draft[setting.key] ?? '').trim().replace(',', '.'),
          ]),
        ),
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(posSurchargesQuery.queryKey, updated);
      queryClient.setQueryData<Record<string, string> | undefined>(
        settingsValuesQuery.queryKey,
        (current) => ({
          ...current,
          ...Object.fromEntries(updated.settings.map((setting) => [setting.key, setting.value])),
        }),
      );
      setDraft({});
      setError(null);
      setSaved(true);
    },
    onError: (reason: unknown) => {
      setSaved(false);
      setError(
        reason instanceof ApiError ? reason.message : 'No se han podido guardar los importes.',
      );
    },
  });

  if (surcharges.isPending) return <p className="text-sm text-slate-500">Cargando los importes…</p>;
  if (surcharges.isError || !surcharges.data) {
    return <p className="text-sm text-red-600">No se han podido cargar los importes del TPV.</p>;
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-1">
        {surcharges.data.settings.map((setting) => (
          <SettingField
            key={setting.key}
            definition={setting}
            value={draft[setting.key] ?? setting.value}
            isDirty={changed.some((changedSetting) => changedSetting.key === setting.key)}
            disabled={save.isPending}
            onChange={(next) => {
              setDraft((current) => ({ ...current, [setting.key]: next }));
              setError(null);
              setSaved(false);
            }}
          />
        ))}
      </div>
      {error && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={changed.length === 0 || save.isPending}
          onClick={() => save.mutate()}
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50 disabled:hover:bg-brand-700"
        >
          {save.isPending ? 'Guardando…' : 'Guardar importes'}
        </button>
        {changed.length > 0 && !save.isPending && (
          <span className="text-sm text-amber-800">
            {changed.length === 1 ? '1 cambio pendiente' : `${changed.length} cambios pendientes`}
          </span>
        )}
        {saved && changed.length === 0 && (
          <span className="text-sm font-medium text-green-700">
            Guardado. Ya está aplicado en la caja.
          </span>
        )}
      </div>
    </section>
  );
}
