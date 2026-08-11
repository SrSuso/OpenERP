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

/** Como `useShopFlag`, pero distinguiendo "todavía no se sabe"
 * (`undefined`) de "está apagado".
 *
 * `useShopFlag` devuelve el valor por defecto mientras carga, que es justo
 * lo que hace falta para pintar sin parpadeos. Para *actuar* —imprimir un
 * ticket, por ejemplo— eso no vale: se haría igualmente en una tienda que
 * lo tiene apagado, antes de que llegue su respuesta. Si la consulta falla
 * se responde con el valor por defecto, para no quedarse esperando para
 * siempre a algo que no va a llegar. */
export function useSettledShopFlag(key: string, fallback: boolean): boolean | undefined {
  const { data, isPending } = useQuery(settingsValuesQuery);
  if (isPending) return undefined;
  return (data?.[key] ?? (fallback ? 'true' : 'false')) === 'true';
}
