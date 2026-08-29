import { useEffect, type RefObject } from 'react';
import { useBlocker } from 'react-router';

/** El aviso de siempre, con las mismas palabras en todas partes: si se ha
 * tocado algo y se sale sin guardar, se pregunta antes. Devuelve `true` si
 * el usuario confirma que quiere descartar.
 *
 * `window.confirm` a propósito, y no un diálogo propio: es lo que ya usan
 * las demás confirmaciones del panel (borrar, ocultar, reconstruir), sale
 * por encima de todo y no hay forma de perdérselo. */
export function confirmDiscard(): boolean {
  return window.confirm(
    'Has hecho cambios que no has guardado.\n\n¿Salir de todas formas y perderlos?',
  );
}

/** Envuelve el «Cancelar»/«Cerrar» de un formulario: con cambios sin
 * guardar pregunta, sin ellos cierra sin molestar. */
export function cancelWithConfirm(isDirty: boolean, onCancel: () => void): () => void {
  return () => {
    if (isDirty && !confirmDiscard()) return;
    onCancel();
  };
}

/** Y el otro camino para perder lo escrito: cerrar la pestaña, recargar, o
 * darle a la flecha de atrás del navegador. El navegador enseña su propio
 * mensaje (no deja elegir el texto), pero preguntar lo hace igual.
 *
 * Se registra mientras `isDirty` sea cierto y se quita en cuanto se
 * guarda o se cancela, así que un formulario limpio no estorba. */
export function useUnsavedWarning(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Necesario para que Chrome/Safari lo tomen en serio, aunque el
      // texto en sí lo pone el navegador desde hace años.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
}

/** Protege también la navegación dentro de la SPA (menú lateral, enlaces y
 * atrás del navegador). `beforeunload` no interviene ahí porque la página no
 * llega a recargarse. La app usa un data router, así que `useBlocker` detiene
 * el cambio antes de desmontar el formulario. */
export function useUnsavedNavigationWarning(
  isDirty: boolean,
  bypassRef?: RefObject<boolean>,
): void {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname && isDirty && !bypassRef?.current,
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (confirmDiscard()) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
}
