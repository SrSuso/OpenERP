import { useEffect, useState } from 'react';

import { type SettingDefinition } from '@/features/settings/optionsApi';
import { formatQuantity } from '@/lib/format';

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

function normaliseColour(value: string): string {
  return HEX_COLOUR.test(value) ? value.toLowerCase() : '#000000';
}

function hexToHsl(hex: string): { hue: number; saturation: number; lightness: number } {
  const source = normaliseColour(hex);
  const red = Number.parseInt(source.slice(1, 3), 16) / 255;
  const green = Number.parseInt(source.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(source.slice(5, 7), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  if (delta === 0) return { hue: 0, saturation: 0, lightness: Math.round(lightness * 100) };

  let hue = 0;
  if (maximum === red) hue = ((green - blue) / delta) % 6;
  else if (maximum === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  return { hue, saturation: Math.round(saturation * 100), lightness: Math.round(lightness * 100) };
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const normalisedHue = ((hue % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * (lightness / 100) - 1)) * (saturation / 100);
  const segment = normalisedHue / 60;
  const match = chroma * (1 - Math.abs((segment % 2) - 1));
  const offset = lightness / 100 - chroma / 2;
  const [red, green, blue] =
    segment < 1
      ? [chroma, match, 0]
      : segment < 2
        ? [match, chroma, 0]
        : segment < 3
          ? [0, chroma, match]
          : segment < 4
            ? [0, match, chroma]
            : segment < 5
              ? [match, 0, chroma]
              : [chroma, 0, match];
  const channel = (value: number) =>
    Math.round((value + offset) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

function ColourControl({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const colour = normaliseColour(value);
  const [hexDraft, setHexDraft] = useState(colour);
  const { hue, saturation, lightness } = hexToHsl(colour);

  useEffect(() => setHexDraft(colour), [colour]);

  function choose(next: string) {
    const exact = normaliseColour(next);
    setHexDraft(exact);
    onChange(exact);
  }

  return (
    <div className="mt-1 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="color"
          value={colour}
          disabled={disabled}
          onChange={(event) => choose(event.target.value)}
          className="h-9 w-16 cursor-pointer rounded border border-slate-300 disabled:cursor-not-allowed"
        />
        <input
          type="text"
          value={hexDraft}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            setHexDraft(next);
            if (HEX_COLOUR.test(next)) choose(next);
          }}
          aria-label={`${label}: hexadecimal`}
          spellCheck={false}
          maxLength={7}
          className="w-24 rounded border border-slate-300 px-2 py-1 font-mono text-xs disabled:bg-slate-50 disabled:text-slate-500"
        />
      </div>
      <div className="grid max-w-xl gap-2 sm:grid-cols-3">
        {(
          [
            ['Tono', 'hue', hue, 360],
            ['Saturación', 'saturation', saturation, 100],
            ['Luminosidad', 'lightness', lightness, 100],
          ] as const
        ).map(([name, channel, current, maximum]) => (
          <label key={channel} className="text-xs text-slate-600">
            {name}: {current}
            {channel === 'hue' ? '°' : '%'}
            <input
              type="range"
              min="0"
              max={maximum}
              value={current}
              disabled={disabled}
              aria-label={`${label}: ${name.toLowerCase()}`}
              onChange={(event) => {
                const next = Number(event.target.value);
                choose(
                  hslToHex(
                    channel === 'hue' ? next : hue,
                    channel === 'saturation' ? next : saturation,
                    channel === 'lightness' ? next : lightness,
                  ),
                );
              }}
              className="mt-1 block w-full accent-brand-600"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

/** Cómo se lee un valor guardado cuando hay que nombrarlo en una frase
 * ("Valor por defecto: …") en vez de meterlo en un campo. */
function describeValue(definition: SettingDefinition, value: string): string {
  if (definition.type === 'BOOL') return value === 'true' ? 'activado' : 'desactivado';
  if (definition.type === 'COLOR') return value;
  if (definition.type === 'ENUM') {
    return definition.choices.find((choice) => choice.value === value)?.label ?? value;
  }
  return value === '' ? '(vacío)' : value;
}

/** El texto de ayuda más, si el registro los declara, los límites — a quien
 * rellena un número le sirve más saber el rango antes de escribirlo que
 * después, en un 422. */
function helpText(definition: SettingDefinition): string {
  const { help, minimum, maximum } = definition;
  if (minimum !== null && maximum !== null) {
    return `${help} Entre ${formatQuantity(minimum)} y ${formatQuantity(maximum)}.`;
  }
  if (minimum !== null) return `${help} Como mínimo ${formatQuantity(minimum)}.`;
  if (maximum !== null) return `${help} Como máximo ${formatQuantity(maximum)}.`;
  return help;
}

interface SettingFieldProps {
  definition: SettingDefinition;
  /** El valor que se está editando, que no tiene por qué ser el guardado. */
  value: string;
  /** Editado y todavía sin guardar. */
  isDirty: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}

/** Un ajuste cualquiera, pintado a partir de su definición y nada más: el
 * componente no sabe qué opción es ni qué hace, sólo su `type`. */
export function SettingField({
  definition,
  value,
  isDirty,
  disabled,
  onChange,
}: SettingFieldProps) {
  const inputId = `setting-${definition.key}`;
  const inputClass =
    'mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500';

  let control;
  switch (definition.type) {
    case 'BOOL':
      control = (
        <input
          id={inputId}
          type="checkbox"
          checked={value === 'true'}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked ? 'true' : 'false')}
          className="h-5 w-5 rounded border-slate-300"
        />
      );
      break;
    case 'ENUM':
      control = (
        <select
          id={inputId}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        >
          {definition.choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'INT':
    case 'DECIMAL':
      control = (
        <input
          id={inputId}
          type="text"
          inputMode={definition.type === 'INT' ? 'numeric' : 'decimal'}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClass} sm:w-40`}
        />
      );
      break;
    case 'COLOR':
      control = (
        <ColourControl
          id={inputId}
          label={definition.label}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      );
      break;
    case 'SECRET':
      control = (
        <input
          id={inputId}
          type="password"
          autoComplete="new-password"
          value={value}
          disabled={disabled}
          placeholder={definition.is_set ? 'Guardada — escribe para cambiarla' : 'Sin guardar'}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        />
      );
      break;
    case 'TEXT':
      control = (
        <textarea
          id={inputId}
          rows={3}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        />
      );
      break;
    case 'HOST':
      control = (
        <input
          id={inputId}
          type="text"
          value={value}
          disabled={disabled}
          spellCheck={false}
          placeholder="192.168.1.50 o caja.example.local"
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClass} font-mono`}
        />
      );
      break;
    default:
      control = (
        <input
          id={inputId}
          type="text"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        />
      );
  }

  // Un secreto no se lee, así que no hay con qué comparar: nunca se enseña
  // "Valor por defecto" ni el botón de restablecer, que darían a entender
  // que se está viendo lo que hay guardado.
  const isDefault = definition.type === 'SECRET' || value === definition.default;
  const isCheckbox = definition.type === 'BOOL';

  return (
    <div
      className={`rounded-md border px-3 py-2.5 ${
        isDirty ? 'border-amber-300 bg-amber-50/50' : 'border-transparent'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex items-center gap-2">
          {isCheckbox && control}
          <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
            {definition.label}
          </label>
          {isCheckbox && (
            <span className="text-xs text-slate-500">
              {value === 'true' ? 'Activado' : 'Desactivado'}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {isDirty && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              Sin guardar
            </span>
          )}
          {!isDefault && !disabled && (
            <button
              type="button"
              onClick={() => onChange(definition.default)}
              aria-label={`Restablecer ${definition.label}`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Restablecer
            </button>
          )}
        </span>
      </div>

      {!isCheckbox && control}

      <p className="mt-1 text-xs text-slate-500">{helpText(definition)}</p>

      {!isDefault && (
        <p className="mt-0.5 text-xs text-slate-400">
          Valor por defecto: {describeValue(definition, definition.default)}
        </p>
      )}

      {definition.caution && (
        <p className="mt-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
          <span className="font-semibold">Ojo: </span>
          {definition.caution}
        </p>
      )}
    </div>
  );
}
