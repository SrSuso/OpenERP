import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { z } from 'zod';

import { useShopSetting } from '@/features/settings/useShopSettings';
import { API_V1, apiFetch } from '@/lib/api';
import { onChangeBroadcast } from '@/lib/changeBroadcast';

/** Lo que la caja enseña y que se cambia desde el panel: productos y sus
 * precios, los botones del TPV, las fotos de unos y otros, los ajustes de
 * tienda (colores, tamaño de letra, nombres de las formas de pago, si el
 * ticket sale solo) y la plantilla del ticket.
 *
 * `['images']` a secas cubre las dos clases de foto (producto y categoría
 * POS) y cualquiera que se añada después. Hace falta aparte de los
 * productos: la foto no viaja en el producto, sino como un número de
 * versión que forma la URL de la imagen — sin refrescar ese número, la
 * caja sigue pidiendo la foto vieja aunque el producto ya esté al día.
 *
 * No entra nada de la venta en curso: el carrito y los tickets abiertos
 * viven en el servidor y se refrescan solos al operar con ellos. Recargar
 * eso cada pocos segundos no aportaría nada y podría pisar lo que el
 * cajero está haciendo. */
const LIVE_KEYS = [
  ['pos', 'products'],
  ['pos', 'categories'],
  ['images'],
  ['settings', 'values'],
  ['tickets', 'templates'],
] as const;

/** Una huella de cómo está el catálogo ahora mismo — ver
 * `backend/app/catalog/version.py`. Cabe en una línea, así que preguntarla
 * cada pocos segundos no cuesta nada; el catálogo entero sí. */
const catalogVersionQuery = queryOptions({
  queryKey: ['pos', 'catalog-version'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/catalog-version`, { schema: z.object({ version: z.string() }), signal }),
  staleTime: 0,
});

/** Mantiene la caja al día sin que nadie la toque.
 *
 * La caja está en otro equipo, dedicada, y no se recarga en todo el día:
 * un precio cambiado en el panel tiene que aparecer allí solo. Así que
 * pregunta cada pocos segundos «¿ha cambiado algo?» —una huella, no el
 * catálogo— y sólo cuando la respuesta es distinta a la de antes vuelve a
 * pedir lo gordo. Con `pos.catalog_refresh_seconds` en 3, el precio está
 * puesto antes de que llegues andando hasta la caja.
 *
 * Encima de eso, dos atajos que no cuestan nada:
 *
 * - Si el panel está abierto en el mismo navegador, al guardar avisa a las
 *   demás pestañas y la caja refresca en el acto (`changeBroadcast`).
 * - Al volver a la ventana de la caja se comprueba sin esperar al
 *   siguiente turno.
 *
 * Los tres caminos hacen lo mismo, así que con que funcione uno la caja
 * está al día. */
export function useLiveCatalog(): void {
  const queryClient = useQueryClient();
  const seconds = Number(useShopSetting('pos.catalog_refresh_seconds', '3'));
  const interval = Number.isFinite(seconds) && seconds >= 1 ? seconds : 3;

  const { data } = useQuery({
    ...catalogVersionQuery,
    refetchInterval: interval * 1000,
    // La caja puede estar sin foco (un aviso encima, el salvapantallas) y
    // tiene que seguir enterándose igual.
    refetchIntervalInBackground: true,
  });
  const version = data?.version;

  //: La última huella que ya se refrescó. La primera que llega no
  //: refresca nada: es la foto de lo que la caja acaba de cargar.
  const seen = useRef<string | undefined>(undefined);

  useEffect(() => {
    const check = () => {
      void queryClient.invalidateQueries({ queryKey: catalogVersionQuery.queryKey });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    // Un cambio guardado en otra pestaña del mismo navegador: se vuelve a
    // preguntar la huella en vez de refrescar a lo bruto. Refrescando
    // directamente se hacía dos veces —una por el aviso y otra al sondeo
    // siguiente, que veía la huella distinta—, y encima se refrescaba
    // aunque lo guardado no fuera nada que la caja enseñe.
    const stopListening = onChangeBroadcast(check);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
      stopListening();
    };
  }, [queryClient]);

  useEffect(() => {
    if (version === undefined) return;
    if (seen.current === undefined) {
      seen.current = version;
      return;
    }
    if (seen.current === version) return;
    seen.current = version;
    for (const queryKey of LIVE_KEYS) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [version, queryClient]);
}
