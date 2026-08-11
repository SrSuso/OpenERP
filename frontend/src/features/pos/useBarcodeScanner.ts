import { useEffect, useRef } from 'react';

/** Hueco máximo entre dos teclas para seguir considerándolo un escaneo.
 *
 * Un lector rápido teclea a 10-20 ms por carácter, pero los hay que van a
 * 50-80, y por Bluetooth se nota más. Una persona no baja de 150 ms entre
 * teclas ni escribiendo muy rápido, así que 120 deja pasar a cualquier
 * lector sin llegar a confundirse con alguien tecleando. */
const MAX_GAP_MS = 120;

/** Por debajo de esto no es un código de barras, es alguien que ha pulsado
 * una tecla suelta con el foco fuera de un campo. */
const MIN_LENGTH = 4;

/** Muchos lectores vienen de fábrica sin sufijo: sueltan el código y ya.
 * Si no llega ningún terminador, se da por terminado al dejar de teclear.
 * Tiene que ser bastante más que `MAX_GAP_MS` para no cortar un código por
 * la mitad. */
const IDLE_FLUSH_MS = 400;

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
 * Un lector de pistola se comporta como un teclado: escribe el código muy
 * deprisa y, según cómo venga configurado, lo termina con Intro, con Tab o
 * con nada. Aquí se acumula lo que se teclea y se da por hecho el escaneo
 * de las tres formas: los dos terminadores, y el quedarse quieto.
 *
 * Escribir a mano sigue funcionando igual: mientras el foco esté en un
 * campo, esto no se mete.
 */
export function useBarcodeScanner(onScan: (code: string) => void, enabled: boolean): void {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    let buffer = '';
    let lastKeyAt = 0;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    function flush() {
      const code = buffer;
      buffer = '';
      clearTimeout(idleTimer);
      if (code.length >= MIN_LENGTH) onScanRef.current(code);
      return code.length >= MIN_LENGTH;
    }

    function handle(event: KeyboardEvent) {
      // Con el foco en un campo manda el campo: es donde se teclea a mano
      // un código, los gramos de lo que se pesa o una contraseña.
      if (isTyping(event.target)) return;
      // Un atajo del navegador no es un escaneo.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const now = Date.now();
      if (now - lastKeyAt > MAX_GAP_MS) buffer = '';
      lastKeyAt = now;

      if (event.key === 'Enter' || event.key === 'Tab') {
        // Que el terminador no active además el botón que tuviera el foco
        // ni mueva el foco de sitio.
        if (flush()) event.preventDefault();
        return;
      }

      // Sólo caracteres sueltos: "Shift", "F5" y compañía llegan con
      // nombres largos y no forman parte del código.
      if (event.key.length !== 1) return;
      buffer += event.key;

      // Sin sufijo configurado: se cierra solo al dejar de llegar teclas.
      clearTimeout(idleTimer);
      idleTimer = setTimeout(flush, IDLE_FLUSH_MS);
    }

    document.addEventListener('keydown', handle);
    return () => {
      document.removeEventListener('keydown', handle);
      clearTimeout(idleTimer);
    };
  }, [enabled]);
}
