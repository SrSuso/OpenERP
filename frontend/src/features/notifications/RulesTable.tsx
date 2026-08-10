import { type NotificationRule, type RuleType } from '@/features/notifications/api';

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
  const days = rule.params['days_before_expiration'];
  return `${typeof days === 'number' ? days : 7} días de antelación`;
}

interface RulesTableProps {
  rules: NotificationRule[];
  canManage: boolean;
  onToggleActive: (rule: NotificationRule) => void;
  isToggling: boolean;
}

export function RulesTable({ rules, canManage, onToggleActive, isToggling }: RulesTableProps) {
  if (rules.length === 0) {
    return <p className="text-sm text-slate-500">Todavía no hay ninguna regla.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Nombre</th>
            <th className="px-4 py-2 font-medium">Tipo</th>
            <th className="px-4 py-2 font-medium">Parámetros</th>
            <th className="px-4 py-2 font-medium">Estado</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2 font-medium text-slate-800">{rule.name}</td>
              <td className="px-4 py-2">{RULE_TYPE_LABELS[rule.rule_type]}</td>
              <td className="px-4 py-2">{paramsSummary(rule)}</td>
              <td className="px-4 py-2">
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
              <td className="px-4 py-2 text-right">
                {canManage && (
                  <button
                    type="button"
                    onClick={() => onToggleActive(rule)}
                    disabled={isToggling}
                    className="text-sm font-medium text-brand-700 hover:underline disabled:opacity-50"
                  >
                    {rule.is_active ? 'Desactivar' : 'Activar'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
