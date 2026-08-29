import {
  SEVERITY_LABELS,
  SEVERITY_STYLES,
  type NotificationRule,
  type RuleType,
} from '@/features/notifications/api';

const RULE_TYPE_LABELS: Record<RuleType, string> = {
  LOW_STOCK: 'Stock bajo mínimo',
  EXPIRING_LOT: 'Lotes próximos a caducar',
  CONDITION: 'A mi medida (con condiciones)',
};

function paramsSummary(rule: NotificationRule): string {
  if (rule.rule_type === 'LOW_STOCK') {
    const warehouseId = rule.params['warehouse_id'];
    return typeof warehouseId === 'number' ? `Almacén #${warehouseId}` : 'Todos los almacenes';
  }
  if (rule.rule_type === 'CONDITION') {
    const conditions = rule.params['conditions'];
    const count = Array.isArray(conditions) ? conditions.length : 0;
    const subject = rule.params['subject'];
    const target = subject === 'PRODUCT' ? 'productos' : subject === 'LOT' ? 'lotes' : 'elementos';
    return `${count} ${count === 1 ? 'condición' : 'condiciones'} sobre ${target}`;
  }
  const days = rule.params['days_before_expiration'];
  return `${typeof days === 'number' ? days : 7} días de antelación`;
}

interface RulesTableProps {
  rules: NotificationRule[];
  canManage: boolean;
  onEdit: (rule: NotificationRule) => void;
  onDelete: (rule: NotificationRule) => void;
  onToggleActive: (rule: NotificationRule) => void;
  isMutating: boolean;
}

export function RulesTable({
  rules,
  canManage,
  onEdit,
  onDelete,
  onToggleActive,
  isMutating,
}: RulesTableProps) {
  if (rules.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
        <p className="font-medium text-slate-700">Todavía no hay ninguna regla.</p>
        <p className="mt-1 text-sm text-slate-500">
          Crea una para convertir el stock bajo, las caducidades u otras condiciones en avisos.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Regla</th>
            <th className="px-4 py-3 font-medium">Tipo</th>
            <th className="px-4 py-3 font-medium">Parámetros</th>
            <th className="px-4 py-3 font-medium">Criticidad</th>
            <th className="px-4 py-3 font-medium">Estado</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr
              key={rule.id}
              className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70"
            >
              <td className="px-4 py-3 font-medium text-slate-800">{rule.name}</td>
              <td className="px-4 py-3 text-slate-700">{RULE_TYPE_LABELS[rule.rule_type]}</td>
              <td className="px-4 py-3 text-slate-600">{paramsSummary(rule)}</td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    SEVERITY_STYLES[rule.severity].badge
                  }`}
                >
                  {SEVERITY_LABELS[rule.severity]}
                </span>
              </td>
              <td className="px-4 py-3">
                {rule.is_active ? (
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                    Activa
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                    Inactiva
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {canManage && (
                  <div className="flex justify-end gap-3 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onEdit(rule)}
                      disabled={isMutating}
                      className="text-sm font-medium text-brand-700 hover:underline disabled:opacity-50"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleActive(rule)}
                      disabled={isMutating}
                      className="text-sm font-medium text-slate-600 hover:underline disabled:opacity-50"
                    >
                      {rule.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(rule)}
                      disabled={isMutating}
                      className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
                    >
                      Eliminar
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
