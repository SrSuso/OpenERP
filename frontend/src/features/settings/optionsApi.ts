import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// Mirrors backend/app/settings/schemas.py's `SettingsOptionsRead`. El
// catálogo entero viaja con los valores actuales, así que la pantalla de
// Configuración se pinta sola a partir de esta respuesta: una opción nueva
// en app.settings.registry aparece en el panel sin tocar nada de aquí.

export const settingTypeSchema = z.enum([
  'BOOL',
  'INT',
  'DECIMAL',
  'STRING',
  'TEXT',
  'ENUM',
  // Un color: se elige de un cuadro de colores, no tecleando un
  // hexadecimal.
  'COLOR',
  // Se escribe pero no se lee: el servidor lo devuelve siempre vacío y
  // sólo dice, en `is_set`, si hay algo guardado.
  'SECRET',
]);
export type SettingType = z.infer<typeof settingTypeSchema>;

export const settingChoiceSchema = z.object({
  value: z.string(),
  label: z.string(),
});
export type SettingChoice = z.infer<typeof settingChoiceSchema>;

export const settingDefinitionSchema = z.object({
  key: z.string(),
  group: z.string(),
  label: z.string(),
  help: z.string(),
  type: settingTypeSchema,
  /** Siempre texto, sea cual sea el `type` — se interpreta al pintarlo. Un
   * `SECRET` llega siempre vacío. */
  value: z.string(),
  /** Sólo para `SECRET`: si hay algo guardado, sin decir el qué. */
  is_set: z.boolean(),
  default: z.string(),
  /** Vacío salvo para `ENUM`. */
  choices: z.array(settingChoiceSchema),
  // Un `Decimal` de pydantic llega como cadena, igual que el resto de
  // NUMERIC del API (rule 8) — sólo lo llevan INT y DECIMAL.
  minimum: z.string().nullable(),
  maximum: z.string().nullable(),
  /** Aviso a destacar junto al campo, o `null`. */
  caution: z.string().nullable(),
});
export type SettingDefinition = z.infer<typeof settingDefinitionSchema>;

export const settingsOptionsSchema = z.object({
  /** Orden en que se pintan las tarjetas. */
  groups: z.array(z.string()),
  settings: z.array(settingDefinitionSchema),
});
export type SettingsOptions = z.infer<typeof settingsOptionsSchema>;

export const settingsOptionsQuery = queryOptions({
  queryKey: ['settings', 'options'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/settings/options`, { schema: settingsOptionsSchema, signal }),
});

/** Guarda **sólo** las claves de `values`; el resto se queda como estaba
 * (app.settings.store.update_values), que es lo que permite guardar una
 * tarjeta sin mandar la pantalla entera. La respuesta trae ya el estado
 * completo y actualizado, así que sirve para refrescar la caché sin un GET
 * extra. Un valor inválido devuelve 422 con un mensaje en castellano apto
 * para enseñárselo tal cual a quien lo está editando. */
export async function updateSettingsOptions(
  values: Record<string, string>,
): Promise<SettingsOptions> {
  return apiFetch(`${API_V1}/settings/options`, {
    method: 'PUT',
    schema: settingsOptionsSchema,
    body: { values },
  });
}

/** Sólo los valores, y legible por cualquiera que haya entrado — el TPV lo
 * necesita (nombre de la tienda, forma de pago por defecto) y un cajero no
 * tiene `settings.read`, que es lo que protege el catálogo editable. Ver
 * backend/app/settings/options_router.py's `list_values`. */
export const settingsValuesQuery = queryOptions({
  queryKey: ['settings', 'values'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/settings/values`, { schema: z.record(z.string(), z.string()), signal }),
});
