import { useQuery } from '@tanstack/react-query';

import { settingsValuesQuery } from '@/features/settings/optionsApi';

/** Los ajustes de tienda para las pantallas que sólo necesitan leerlos
 * (menú, TPV), no editarlos. Devuelve el valor por defecto mientras carga,
 * para que nada parpadee ni se quede en blanco entre cliente y cliente.
 *
 * Sólo funciona dentro de una zona con sesión iniciada: el endpoint pide
 * estar autenticado (ver backend/app/settings/options_router.py). La
 * pantalla de entrada, que se pinta antes de eso, no puede usarlo. */
export function useShopSetting(key: string, fallback: string): string {
  const { data } = useQuery(settingsValuesQuery);
  return data?.[key] ?? fallback;
}

export function useShopFlag(key: string, fallback: boolean): boolean {
  const value = useShopSetting(key, fallback ? 'true' : 'false');
  return value === 'true';
}
