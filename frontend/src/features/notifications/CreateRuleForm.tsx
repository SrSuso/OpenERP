import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useState } from 'react';

import { warehousesQuery } from '@/features/inventory/api';
import {
  RULE_TYPES,
  SEVERITIES,
  SEVERITY_LABELS,
  conditionCatalogueQuery,
  type RuleCreateInput,
  type RuleType,
} from '@/features/notifications/api';
import { cancelWithConfirm, useUnsavedWarning } from '@/lib/unsaved';

const RULE_TYPE_LABELS: Record<RuleType, string> = {
  LOW_STOCK: 'Stock bajo mínimo',
  EXPIRING_LOT: 'Lotes próximos a caducar',
  CONDITION: 'A mi medida (con condiciones)',
};

/** Una condición a medio escribir. Se guarda como texto porque el
 * desplegable de campos y el de comparadores vienen del backend
 * (`conditionCatalogueQuery`) y el valor lo teclea el usuario. */
interface DraftCondition {
  field: string;
  operator: string;
  value: string;
}

const createRuleSchema = z.object({
  name: z.string().min(1, 'Introduce un nombre.').max(100),
  rule_type: z.enum(RULE_TYPES),
  severity: z.enum(SEVERITIES),
  warehouse_id: z.string().optional(),
  days_before_expiration: z.coerce.number().int().min(0).max(365).optional(),
});

type CreateRuleFormValues = z.infer<typeof createRuleSchema>;

interface CreateRuleFormProps {
  onSubmit: (payload: RuleCreateInput) => void;
  onCancel: () => void;
  isPending: boolean;
  submitError: string | null;
}

export function CreateRuleForm({
  onSubmit,
  onCancel,
  isPending,
  submitError,
}: CreateRuleFormProps) {
  const warehouses = useQuery(warehousesQuery);
  const catalogue = useQuery(conditionCatalogueQuery);
  const [subject, setSubject] = useState('');
  const [conditions, setConditions] = useState<DraftCondition[]>([]);
  const [conditionError, setConditionError] = useState<string | null>(null);

  const subjectDef = catalogue.data?.subjects.find((s) => s.key === subject);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isDirty },
  } = useForm<CreateRuleFormValues>({
    resolver: zodResolver(createRuleSchema),
    defaultValues: { rule_type: 'LOW_STOCK', severity: 'MEDIUM_LOW', days_before_expiration: 7 },
  });

  const ruleType = watch('rule_type');

  useUnsavedWarning(isDirty);

  const submit = handleSubmit((values) => {
    let params: Record<string, unknown>;
    if (values.rule_type === 'CONDITION') {
      const usable = conditions.filter((c) => c.field && c.operator && c.value.trim());
      if (!subject || usable.length === 0) {
        setConditionError('Elige sobre qué avisar y añade al menos una condición.');
        return;
      }
      setConditionError(null);
      params = {
        subject,
        conditions: usable.map((c) => ({
          field: c.field,
          operator: c.operator,
          value: Number(c.value.replace(',', '.')),
        })),
      };
    } else if (values.rule_type === 'LOW_STOCK') {
      params = { warehouse_id: values.warehouse_id ? Number(values.warehouse_id) : null };
    } else {
      params = { days_before_expiration: values.days_before_expiration ?? 7 };
    }
    onSubmit({
      name: values.name,
      rule_type: values.rule_type,
      severity: values.severity,
      params,
    });
  });

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Nueva regla</h3>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-slate-600">
          Nombre
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('name')}
          />
          {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>}
        </label>

        <label className="text-sm text-slate-600">
          Tipo
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('rule_type')}
          >
            {RULE_TYPES.map((type) => (
              <option key={type} value={type}>
                {RULE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm text-slate-600">
          Criticidad
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('severity')}
          >
            {SEVERITIES.map((level) => (
              <option key={level} value={level}>
                {SEVERITY_LABELS[level]}
              </option>
            ))}
          </select>
        </label>

        {ruleType === 'LOW_STOCK' && (
          <label className="text-sm text-slate-600">
            Almacén (vacío = todos)
            <select
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('warehouse_id')}
            >
              <option value="">Todos los almacenes</option>
              {(warehouses.data ?? []).map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {ruleType === 'EXPIRING_LOT' && (
          <label className="text-sm text-slate-600">
            Avisar con (días de antelación)
            <input
              type="number"
              min={0}
              max={365}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('days_before_expiration')}
            />
          </label>
        )}
      </div>

      {ruleType === 'CONDITION' && (
        <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3">
          <label className="text-sm text-slate-600">
            Avisar sobre
            <select
              value={subject}
              onChange={(event) => {
                setSubject(event.target.value);
                setConditions([]);
              }}
              className="mt-1 block w-64 rounded border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Elige…</option>
              {(catalogue.data?.subjects ?? []).map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {subjectDef && (
            <>
              <p className="mt-3 text-xs text-slate-500">
                Avisa cuando se cumplan <strong>todas</strong> las condiciones.
              </p>
              {conditions.map((condition, index) => {
                const fieldDef = subjectDef.fields.find((f) => f.key === condition.field);
                return (
                  <div key={index} className="mt-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label={`Campo ${index + 1}`}
                        value={condition.field}
                        onChange={(event) =>
                          setConditions((current) =>
                            current.map((c, i) =>
                              i === index ? { ...c, field: event.target.value } : c,
                            ),
                          )
                        }
                        className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                      >
                        <option value="">Campo…</option>
                        {subjectDef.fields.map((field) => (
                          <option key={field.key} value={field.key}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={`Comparador ${index + 1}`}
                        value={condition.operator}
                        onChange={(event) =>
                          setConditions((current) =>
                            current.map((c, i) =>
                              i === index ? { ...c, operator: event.target.value } : c,
                            ),
                          )
                        }
                        className="rounded border border-slate-300 px-2 py-1.5 font-mono text-sm"
                      >
                        {(catalogue.data?.operators ?? []).map((operator) => (
                          <option key={operator} value={operator}>
                            {operator}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Valor ${index + 1}`}
                        value={condition.value}
                        onChange={(event) =>
                          setConditions((current) =>
                            current.map((c, i) =>
                              i === index ? { ...c, value: event.target.value } : c,
                            ),
                          )
                        }
                        className="w-28 rounded border border-slate-300 px-2 py-1.5 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setConditions((current) => current.filter((_, i) => i !== index))
                        }
                        className="text-xs font-medium text-red-600 hover:underline"
                      >
                        Quitar
                      </button>
                    </div>
                    {fieldDef && <p className="mt-1 text-xs text-slate-400">{fieldDef.help}</p>}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() =>
                  setConditions((current) => [...current, { field: '', operator: '<', value: '' }])
                }
                className="mt-2 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white"
              >
                Añadir condición
              </button>
            </>
          )}
          {conditionError && <p className="mt-2 text-sm text-red-600">{conditionError}</p>}
        </div>
      )}

      {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? 'Creando…' : 'Crear'}
        </button>
        <button
          type="button"
          onClick={cancelWithConfirm(isDirty, onCancel)}
          className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
