import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useShopSetting } from '@/features/settings/useShopSettings';
import { onChangeBroadcast } from '@/lib/changeBroadcast';

/** Lo que la caja enseña y que se cambia desde el panel: productos y sus
 * precios, los botones del TPV, los ajustes de tienda (colores, tamaño de
 * letra, nombres de las formas de pago, si el ticket sale solo) y la
 * plantilla del ticket.
 *
 * No entra nada de la venta en curso: el carrito y los tickets abiertos
 * viven en el servidor y se refrescan solos al operar con ellos. Recargar
 * eso cada pocos segundos no aportaría nada y podría pisar lo que el
 * cajero está haciendo. */
const LIVE_KEYS = [
  ['pos', 'products'],
  ['pos', 'categories'],
  ['settings', 'values'],
  ['tickets', 'templates'],
] as const;

/** Mantiene la caja al día sin recargarla.
 *
 * Un cambio guardado en el panel tiene que verse en el TPV en cuanto se
 * guarda, y hay dos caminos porque hay dos situaciones:
 *
 * - Panel y caja en el mismo navegador (lo normal en una tienda de un
 *   equipo): el aviso entre pestañas llega al instante
 *   (`changeBroadcast`).
 * - La caja en otro equipo: no hay aviso posible, así que vuelve a
 *   preguntar cada pocos segundos — `pos.catalog_refresh_seconds`.
 *
 * Y en los dos casos, al volver a la pestaña de la caja se refresca sin
 * esperar al siguiente turno: es el momento exacto en que alguien acaba de
 * cambiar algo en la otra ventana. */
export function useLiveCatalog(): void {
  const queryClient = useQueryClient();
  const seconds = Number(useShopSetting('pos.catalog_refresh_seconds', '10'));
  const interval = Number.isFinite(seconds) && seconds >= 2 ? seconds : 10;

  useEffect(() => {
    const refresh = () => {
      for (const queryKey of LIVE_KEYS) {
        void queryClient.invalidateQueries({ queryKey });
      }
    };

    const timer = window.setInterval(refresh, interval * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const stopListening = onChangeBroadcast(refresh);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
      stopListening();
    };
  }, [queryClient, interval]);
}
