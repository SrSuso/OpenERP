import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { warehousesQuery } from '@/features/inventory/api';
import { RULE_TYPES, type RuleCreateInput, type RuleType } from '@/features/notifications/api';

const RULE_TYPE_LABELS: Record<RuleType, string> = {
  LOW_STOCK: 'Stock bajo mínimo',
  EXPIRING_LOT: 'Lotes próximos a caducar',
};

const createRuleSchema = z.object({
  name: z.string().min(1, 'Introduce un nombre.').max(100),
  rule_type: z.enum(RULE_TYPES),
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
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<CreateRuleFormValues>({
    resolver: zodResolver(createRuleSchema),
    defaultValues: { rule_type: 'LOW_STOCK', days_before_expiration: 7 },
  });

  const ruleType = watch('rule_type');

  const submit = handleSubmit((values) => {
    const params: Record<string, unknown> =
      values.rule_type === 'LOW_STOCK'
        ? { warehouse_id: values.warehouse_id ? Number(values.warehouse_id) : null }
        : { days_before_expiration: values.days_before_expiration ?? 7 };
    onSubmit({ name: values.name, rule_type: values.rule_type, params });
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
          onClick={onCancel}
          className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
