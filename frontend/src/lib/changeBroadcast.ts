/** Un aviso entre pestañas del mismo navegador: «se ha guardado algo».
 *
 * Sirve para que la caja se entere en el acto de un cambio hecho en el
 * panel —un precio, un botón del TPV, el nombre de un producto— cuando las
 * dos están abiertas en el mismo equipo, que es lo normal en una tienda
 * pequeña. No lleva datos: quien escucha vuelve a preguntar al servidor,
 * que es la única fuente de verdad.
 *
 * Para la caja en otro equipo esto no llega, y de eso se encarga el
 * refresco periódico (`useLiveCatalog`). Los dos caminos hacen lo mismo,
 * así que tener sólo uno de los dos también funciona. */
const CHANNEL_NAME = 'openerp-changes';

/** `BroadcastChannel` no existe en algún navegador viejo ni en algunos
 * entornos de prueba: sin él, todo sigue funcionando con el refresco
 * periódico y esto no hace nada. */
function channel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(CHANNEL_NAME);
}

export function broadcastChange(): void {
  const bus = channel();
  if (bus === null) return;
  bus.postMessage('changed');
  bus.close();
}

/** Devuelve la función para dejar de escuchar. */
export function onChangeBroadcast(listener: () => void): () => void {
  const bus = channel();
  if (bus === null) return () => {};
  bus.onmessage = () => listener();
  return () => bus.close();
}
