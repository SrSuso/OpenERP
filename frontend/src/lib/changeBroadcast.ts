/** Un aviso entre pestañas del mismo navegador: «se ha guardado algo».
 *
 * Sirve para que la caja se entere en el acto de un cambio hecho en el
 * panel —un precio, un botón del TPV, el nombre de un producto— cuando las
 * dos están abiertas en el mismo equipo. No lleva datos: quien escucha
 * vuelve a preguntar al servidor, que es la única fuente de verdad.
 *
 * Para la caja en otro equipo esto no llega, y de eso se encarga el
 * refresco periódico (`useLiveCatalog`). Los dos caminos hacen lo mismo,
 * así que tener sólo uno de los dos también funciona.
 *
 * Todo pasa por **un único canal por pestaña**, y eso es lo importante:
 * `BroadcastChannel` reparte el mensaje a todos los canales del mismo
 * nombre *menos al que lo envía*. Con un canal para mandar y otro para
 * escuchar —aunque estén en la misma pestaña— la pestaña se avisaba a sí
 * misma, y en el TPV eso significaba recargar el catálogo entero en cada
 * toque a un producto (cada línea del carrito es una escritura). Con uno
 * solo, el aviso sale hacia fuera y no vuelve. */
const CHANNEL_NAME = 'openerp-changes';

const listeners = new Set<() => void>();
let bus: BroadcastChannel | null = null;

/** `BroadcastChannel` no existe en algún navegador viejo ni en algunos
 * entornos de prueba: sin él, todo sigue funcionando con el refresco
 * periódico y esto no hace nada. */
function open(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (bus === null) {
    bus = new BroadcastChannel(CHANNEL_NAME);
    bus.onmessage = () => {
      for (const listener of listeners) listener();
    };
  }
  return bus;
}

export function broadcastChange(): void {
  open()?.postMessage('changed');
}

/** Devuelve la función para dejar de escuchar. */
export function onChangeBroadcast(listener: () => void): () => void {
  if (open() === null) return () => {};
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
