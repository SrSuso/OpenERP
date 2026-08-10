import { type SettingDefinition } from '@/features/settings/optionsApi';
import { formatQuantity } from '@/lib/format';

/** Cómo se lee un valor guardado cuando hay que nombrarlo en una frase
 * ("Valor por defecto: …") en vez de meterlo en un campo. */
function describeValue(definition: SettingDefinition, value: string): string {
  if (definition.type === 'BOOL') return value === 'true' ? 'activado' : 'desactivado';
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

  const isDefault = value === definition.default;
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
