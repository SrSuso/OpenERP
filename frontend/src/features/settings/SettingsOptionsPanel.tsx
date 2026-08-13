import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { SettingField } from '@/features/settings/SettingField';
import {
  settingsOptionsQuery,
  settingsValuesQuery,
  updateSettingsOptions,
  type SettingDefinition,
} from '@/features/settings/optionsApi';
import { ApiError } from '@/lib/api';

/** Sin tildes y en minúsculas: quien busca "articulo" con prisa entre dos
 * clientes tiene que encontrar "artículo". */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function matchesSearch(definition: SettingDefinition, search: string): boolean {
  const needle = normalise(search.trim());
  if (!needle) return true;
  return normalise(`${definition.label} ${definition.help}`).includes(needle);
}

/** Un número escrito a la española ("12,5") es lo normal aquí, pero el
 * backend espera el punto decimal — igual que hace `decimalString` con el
 * resto de los formularios. */
function normaliseForBackend(definition: SettingDefinition, value: string): string {
  if (definition.type === 'INT' || definition.type === 'DECIMAL') {
    return value.trim().replace(',', '.');
  }
  return value;
}

/** Los ajustes de negocio del registro (backend/app/settings/registry.py),
 * pintados enteramente a partir del JSON del API: grupos, etiquetas, tipos
 * de campo, ayudas y avisos vienen de allí, así que una opción nueva sale
 * en esta pantalla sin tocar el frontend. */
export function SettingsOptionsPanel({ canManage }: { canManage: boolean }) {
  const options = useQuery(settingsOptionsQuery);
  const [search, setSearch] = useState('');
  /** Sólo las claves que se han tocado. El resto se lee del servidor, así
   * que un guardado de otra tarjeta no pisa lo que se esté escribiendo. */
  const [draft, setDraft] = useState<Record<string, string>>({});

  const edited = (options.data?.settings ?? []).filter((definition) => {
    const drafted = draft[definition.key];
    return drafted !== undefined && drafted !== definition.value;
  });
  const editedKeys = new Set(edited.map((definition) => definition.key));
  const editedGroups = [...new Set(edited.map((definition) => definition.group))];

  if (options.isPending) {
    return <p className="text-sm text-slate-500">Cargando las opciones…</p>;
  }
  if (options.isError || !options.data) {
    return <p className="text-sm text-red-600">No se han podido cargar las opciones.</p>;
  }

  const { groups, settings } = options.data;
  const visibleGroups = groups
    .map((group) => ({
      group,
      // Un campo editado y sin guardar no se esconde nunca: filtrar no
      // puede hacerle perder a nadie un cambio a medio hacer.
      fields: settings.filter(
        (definition) =>
          definition.group === group &&
          (matchesSearch(definition, search) || editedKeys.has(definition.key)),
      ),
    }))
    .filter((entry) => entry.fields.length > 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <label className="text-sm text-slate-600">
          Buscar una opción
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ticket, descuento, stock…"
            className="mt-1 block w-64 rounded border border-slate-300 px-3 py-1.5 text-sm"
          />
        </label>
        {edited.length > 0 && (
          <p className="pb-1.5 text-sm text-amber-800">
            Tienes {edited.length === 1 ? '1 cambio' : `${edited.length} cambios`} sin guardar en:{' '}
            {editedGroups.join(', ')}.
          </p>
        )}
      </div>

      {visibleGroups.length === 0 && (
        <p className="text-sm text-slate-500">
          Ninguna opción coincide con «{search}». Prueba con otra palabra.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {visibleGroups.map(({ group, fields }) => (
          <SettingsGroupCard
            key={group}
            group={group}
            fields={fields}
            draft={draft}
            canManage={canManage}
            onChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))}
            onSaved={(keys) =>
              setDraft((current) => {
                const next = { ...current };
                for (const key of keys) delete next[key];
                return next;
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

interface SettingsGroupCardProps {
  group: string;
  fields: SettingDefinition[];
  draft: Record<string, string>;
  canManage: boolean;
  onChange: (key: string, value: string) => void;
  onSaved: (keys: string[]) => void;
}

/** Una tarjeta por grupo, con su propio botón de guardar: el dueño de la
 * tienda cambia una cosa y la confirma ahí mismo, sin un "guardar todo" que
 * mande de vuelta media pantalla que no ha mirado. */
function SettingsGroupCard({
  group,
  fields,
  draft,
  canManage,
  onChange,
  onSaved,
}: SettingsGroupCardProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const changed = fields.filter((definition) => {
    const drafted = draft[definition.key];
    return drafted !== undefined && drafted !== definition.value;
  });
  const changedKeys = new Set(changed.map((definition) => definition.key));

  const saveMutation = useMutation({
    mutationFn: () => {
      const values: Record<string, string> = {};
      for (const definition of changed) {
        values[definition.key] = normaliseForBackend(definition, draft[definition.key] ?? '');
      }
      return updateSettingsOptions(values);
    },
    onSuccess: (data) => {
      // El PUT ya devuelve el estado completo y actualizado, así que la
      // caché se refresca sin un GET de vuelta.
      queryClient.setQueryData(settingsOptionsQuery.queryKey, data);
      queryClient.setQueryData(
        settingsValuesQuery.queryKey,
        Object.fromEntries(
          data.settings
            .filter((definition) => definition.type !== 'SECRET')
            .map((definition) => [definition.key, definition.value]),
        ),
      );
      onSaved(changed.map((definition) => definition.key));
      setError(null);
      setSaved(true);
    },
    onError: (err: unknown) => {
      setSaved(false);
      // El 422 del registro ya viene redactado en castellano y nombrando la
      // opción ("Descuento máximo por línea (%): no puede ser mayor que
      // 100."), así que se enseña tal cual.
      setError(err instanceof ApiError ? err.message : 'No se ha podido guardar.');
    },
  });

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{group}</h3>

      <div className="flex flex-col gap-1">
        {fields.map((definition) => (
          <SettingField
            key={definition.key}
            definition={definition}
            value={draft[definition.key] ?? definition.value}
            isDirty={changedKeys.has(definition.key)}
            disabled={!canManage}
            onChange={(value) => {
              setSaved(false);
              setError(null);
              onChange(definition.key, value);
            }}
          />
        ))}
      </div>

      {error && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {canManage && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            disabled={changed.length === 0 || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            aria-label={`Guardar cambios de ${group}`}
            className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50 disabled:hover:bg-brand-700"
          >
            {saveMutation.isPending ? 'Guardando…' : 'Guardar cambios'}
          </button>
          {changed.length > 0 && !saveMutation.isPending && (
            <span className="text-sm text-amber-800">
              {changed.length === 1 ? '1 cambio pendiente' : `${changed.length} cambios pendientes`}
            </span>
          )}
          {saved && changed.length === 0 && (
            <span className="text-sm font-medium text-green-700">
              Guardado. Ya está aplicado en la tienda.
            </span>
          )}
        </div>
      )}
    </section>
  );
}
