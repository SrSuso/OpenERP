import { useEffect, useRef } from 'react';

/** Un lector teclea un código entero en unas decenas de milisegundos; una
 * persona no baja de ~100 ms entre teclas ni de lejos. Si pasa más tiempo
 * del que cabe aquí entre dos teclas, lo de antes no era un escaneo. */
const MAX_GAP_MS = 60;

/** Por debajo de esto no es un código de barras, es alguien que ha pulsado
 * Intro con dos teclas sueltas encima. */
const MIN_LENGTH = 4;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true
  );
}

/**
 * Escucha el lector de códigos de barras en toda la pantalla, sin tener que
 * pinchar antes en ningún recuadro.
 *
 * Un lector de los de pistola se comporta como un teclado: escribe el
 * código muy deprisa y termina con Intro. Aquí se acumula lo que se teclea
 * y, al llegar el Intro, si vino a la velocidad de una máquina y es lo
 * bastante largo, se trata como un escaneo. Escribir a mano en cualquier
 * recuadro sigue funcionando igual: mientras el foco esté en un campo, esto
 * no se mete.
 */
export function useBarcodeScanner(onScan: (code: string) => void, enabled: boolean): void {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    let buffer = '';
    let lastKeyAt = 0;

    function handle(event: KeyboardEvent) {
      // Con el foco en un campo manda el campo: es donde se teclea a mano
      // un código, los gramos de lo que se pesa o la contraseña.
      if (isTyping(event.target)) return;
      // Un atajo del navegador no es un escaneo.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const now = Date.now();
      if (now - lastKeyAt > MAX_GAP_MS) buffer = '';
      lastKeyAt = now;

      if (event.key === 'Enter') {
        const code = buffer;
        buffer = '';
        if (code.length >= MIN_LENGTH) {
          // Que no active además el botón que tuviera el foco.
          event.preventDefault();
          onScanRef.current(code);
        }
        return;
      }

      // Sólo caracteres sueltos: "Shift", "Tab" y compañía llegan con
      // nombres largos y no forman parte del código.
      if (event.key.length === 1) buffer += event.key;
    }

    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [enabled]);
}
