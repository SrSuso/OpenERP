import { useEffect, useRef } from 'react';

/** Deja elegida la primera opción de un desplegable en cuanto llega su
 * lista. La mayoría de tiendas tienen un almacén y una ubicación: obligar a
 * desplegarlos para elegir lo único que hay era un paso de más en cada
 * ajuste, transferencia y recepción.
 *
 * No pisa lo que ya esté elegido, salvo que deje de estar entre las
 * opciones — que es justo lo que le pasa a la ubicación al cambiar de
 * almacén: en vez de quedarse apuntando a una estantería del almacén
 * anterior, salta a la primera del nuevo.
 *
 * `options` a `undefined` significa "todavía cargando": ahí no toca nada,
 * porque una lista vacía y una lista que aún no ha llegado no son lo mismo.
 */
export function useDefaultToFirstOption(
  current: string | undefined,
  options: readonly { id: number }[] | undefined,
  select: (value: string) => void,
): void {
  // Por referencia: `select` suele ser una función anónima distinta en cada
  // render, y no es un motivo para volver a elegir nada.
  const selectRef = useRef(select);
  selectRef.current = select;

  // Como cadena, para que el efecto dependa de valores y no de la identidad
  // del array que devuelve la consulta.
  const available = options?.map((option) => String(option.id)).join(',');

  useEffect(() => {
    if (available === undefined) return;
    const ids = available === '' ? [] : available.split(',');
    if (current !== undefined && current !== '' && ids.includes(current)) return;
    selectRef.current(ids[0] ?? '');
  }, [available, current]);
}
