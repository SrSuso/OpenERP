interface KeypadProps {
  /** Lo tecleado hasta ahora, como cadena de dígitos. */
  value: string;
  onChange: (value: string) => void;
  /** Cuántos dígitos caben — evita que un dedo apoyado deje un número
   * absurdo. */
  maxLength?: number;
  /** Amount prompts accept one decimal separator; quantities keep digits only. */
  allowDecimal?: boolean;
  /** El primer toque sustituye el importe inicial en vez de añadirle un
   * dígito. Útil cuando el efectivo empieza mostrando el total exacto. */
  clearOnFirstInput?: boolean;
  /** Se dibuja en la última casilla, junto a «C» y «←». */
  action?: { label: string; onPress: () => void; disabled?: boolean };
}

const DIGITS = ['7', '8', '9', '4', '5', '6', '1', '2', '3'];

const KEY =
  'pos-button-secondary rounded py-4 text-xl font-semibold transition active:brightness-110 disabled:opacity-40';

/** Teclado numérico para usar con el dedo: en una caja no hay teclado
 * físico a mano, y el del móvil tapa media pantalla justo cuando hace
 * falta ver lo que se está cobrando.
 *
 * Sirve tanto para los gramos de lo que se pesa como para multiplicar
 * unidades — el número es el mismo gesto, lo que cambia es quién lo usa. */
export function Keypad({
  value,
  onChange,
  maxLength = 6,
  allowDecimal = false,
  clearOnFirstInput = false,
  action,
}: KeypadProps) {
  function press(digit: string) {
    // Un cero a la izquierda no significa nada y confunde al leerlo.
    const current = clearOnFirstInput ? '' : value;
    const next = current === '0' ? digit : current + digit;
    if (next.length > maxLength) return;
    onChange(next);
  }

  function pressDecimal() {
    const current = clearOnFirstInput ? '' : value;
    if (!allowDecimal || current.includes(',') || current.includes('.')) return;
    onChange(current === '' ? '0,' : `${current},`);
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {DIGITS.map((digit) => (
        <button key={digit} type="button" onClick={() => press(digit)} className={KEY}>
          {digit}
        </button>
      ))}
      <button type="button" onClick={() => onChange('')} className={KEY} aria-label="Borrar todo">
        C
      </button>
      <button type="button" onClick={() => press('0')} className={KEY}>
        0
      </button>
      <button
        type="button"
        onClick={() => onChange(value.slice(0, -1))}
        className={KEY}
        aria-label="Borrar un dígito"
      >
        ←
      </button>
      {allowDecimal && (
        <button type="button" onClick={pressDecimal} className={KEY}>
          ,
        </button>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onPress}
          disabled={action.disabled}
          className="pos-button-primary col-span-3 rounded py-4 text-lg font-semibold transition active:brightness-110 disabled:opacity-40"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
