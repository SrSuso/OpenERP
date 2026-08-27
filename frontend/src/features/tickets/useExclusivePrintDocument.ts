import { useCallback, useEffect, useId, useRef } from 'react';

const PRINT_DOCUMENT_EVENT = 'openerp:activate-print-document';

/**
 * Mantiene el documento elegido durante toda la composición nativa. Chromium
 * abre su previsualización de forma asíncrona: retirarlo justo después de
 * `window.print()` hacía que la previsualización volviera a componer la UI de
 * pantalla (A4 y con huecos), en vez del ticket térmico.
 */
export function printActiveDocument(onFinished: () => void): void {
  const finish = () => {
    window.removeEventListener('afterprint', finish);
    onFinished();
  };

  window.addEventListener('afterprint', finish, { once: true });
  window.print();
}

/**
 * Hay muchos puntos que pueden imprimir (venta, reimpresión, Z), pero el
 * navegador sólo puede componer un documento cada vez. Al activar uno se
 * desactiva cualquier documento anterior que hubiera quedado visible tras
 * cancelar el diálogo del sistema; así nunca se acumulan dos tickets en el
 * siguiente `window.print()`.
 */
export function useExclusivePrintDocument(onSuperseded: () => void): () => void {
  const ownerId = useId();
  const onSupersededRef = useRef(onSuperseded);
  onSupersededRef.current = onSuperseded;

  useEffect(() => {
    const clearIfAnotherDocumentActivates = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail !== ownerId) {
        onSupersededRef.current();
      }
    };
    window.addEventListener(PRINT_DOCUMENT_EVENT, clearIfAnotherDocumentActivates);
    return () => window.removeEventListener(PRINT_DOCUMENT_EVENT, clearIfAnotherDocumentActivates);
  }, [ownerId]);

  return useCallback(() => {
    window.dispatchEvent(new CustomEvent(PRINT_DOCUMENT_EVENT, { detail: ownerId }));
  }, [ownerId]);
}
