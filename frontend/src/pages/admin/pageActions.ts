/** Los botones que encabezan una pantalla del panel: «Nuevo producto»,
 * «Desactivar», «Procesar ahora»…
 *
 * Antes iban en cuerpo pequeño y empujados contra el borde derecho de la
 * pantalla: en un monitor ancho quedaban a un palmo de donde está mirando
 * quien trabaja, que es la izquierda. Ahora son claramente más grandes y
 * van justo a continuación de lo que tienen al lado —el título o los
 * filtros—, hacia el centro, en vez de al extremo.
 *
 * Están aquí, y no repetidos en cada pantalla, para que cambiarlos otra
 * vez sea tocar un sitio. */

/** Fila de cabecera cuando a la izquierda hay filtros (se alinean por
 * abajo, para que el botón quede a la altura de las cajas). */
export const pageHeaderRow = 'mb-4 flex flex-wrap items-end gap-x-8 gap-y-3';

/** Fila de cabecera cuando a la izquierda hay un título. */
export const pageTitleRow = 'mb-6 flex flex-wrap items-center gap-x-8 gap-y-3';

const base = 'rounded px-6 py-3 text-base font-semibold disabled:opacity-50';

/** La acción principal de la pantalla (crear, añadir…). */
export const primaryAction = `${base} bg-brand-700 text-white hover:bg-brand-600`;

/** Acciones de servicio, junto a la principal (procesar, evaluar…). */
export const secondaryAction = `${base} bg-slate-700 text-white hover:bg-slate-600`;

/** Lo que cuesta deshacer: desactivar, dar de baja. */
export const dangerAction = `${base} border-2 border-red-300 text-red-600 hover:bg-red-50`;
