import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/features/auth/AuthContext';
import { CreateRuleForm } from '@/features/notifications/CreateRuleForm';
import { IncidentsTable } from '@/features/notifications/IncidentsTable';
import { RulesTable } from '@/features/notifications/RulesTable';
import {
  createRule,
  evaluateRules,
  incidentsQuery,
  notificationRulesQuery,
  resolveIncident,
  updateRule,
  type Incident,
  type NotificationRule,
  type RuleCreateInput,
} from '@/features/notifications/api';

const tabClassName = (active: boolean) =>
  `border-b-2 px-4 py-2 text-sm font-medium ${
    active
      ? 'border-brand-700 text-brand-700'
      : 'border-transparent text-slate-500 hover:text-slate-700'
  }`;

/** `/admin/notifications` — gated by `notification.read`; crear/editar
 * reglas, evaluar y resolver incidencias necesita `notification.manage`. */
export function NotificationsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('notification.manage');

  const [tab, setTab] = useState<'rules' | 'incidents'>('rules');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('OPEN');

  const rules = useQuery(notificationRulesQuery);
  const incidents = useQuery(incidentsQuery(statusFilter === '' ? {} : { status: statusFilter }));
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (payload: RuleCreateInput) => createRule(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationRulesQuery.queryKey });
      setShowCreateForm(false);
      setCreateError(null);
    },
    onError: () => setCreateError('No se ha podido crear la regla.'),
  });

  const toggleMutation = useMutation({
    mutationFn: (rule: NotificationRule) => updateRule(rule.id, { is_active: !rule.is_active }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: notificationRulesQuery.queryKey }),
  });

  const evaluateMutation = useMutation({
    mutationFn: () => evaluateRules(),
    onSuccess: (result: Incident[]) => {
      queryClient.setQueryData(incidentsQuery({}).queryKey, result);
      void queryClient.invalidateQueries({ queryKey: ['notifications', 'incidents'] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (id: number) => resolveIncident(id),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['notifications', 'incidents'] }),
  });

  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">Notificaciones</h1>

      <nav className="mb-6 flex gap-2 border-b border-slate-200" aria-label="Notificaciones">
        <button
          type="button"
          onClick={() => setTab('rules')}
          className={tabClassName(tab === 'rules')}
        >
          Reglas
        </button>
        <button
          type="button"
          onClick={() => setTab('incidents')}
          className={tabClassName(tab === 'incidents')}
        >
          Incidencias
        </button>
      </nav>

      {tab === 'rules' && (
        <div>
          {canManage && !showCreateForm && (
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              className="mb-4 rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
            >
              Nueva regla
            </button>
          )}

          {showCreateForm && (
            <CreateRuleForm
              isPending={createMutation.isPending}
              submitError={createError}
              onCancel={() => {
                setShowCreateForm(false);
                setCreateError(null);
              }}
              onSubmit={(payload) => createMutation.mutate(payload)}
            />
          )}

          {rules.data && (
            <RulesTable
              rules={rules.data}
              canManage={canManage}
              onToggleActive={(rule) => toggleMutation.mutate(rule)}
              isToggling={toggleMutation.isPending}
            />
          )}
        </div>
      )}

      {tab === 'incidents' && (
        <div>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <label className="text-sm text-slate-600">
              Estado
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="mt-1 block rounded border border-slate-300 px-3 py-1.5 text-sm"
              >
                <option value="OPEN">Abiertas</option>
                <option value="RESOLVED">Resueltas</option>
                <option value="">Todas</option>
              </select>
            </label>

            {canManage && (
              <button
                type="button"
                onClick={() => evaluateMutation.mutate()}
                disabled={evaluateMutation.isPending}
                className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {evaluateMutation.isPending ? 'Evaluando…' : 'Evaluar ahora'}
              </button>
            )}
          </div>

          {incidents.data && (
            <IncidentsTable
              incidents={incidents.data}
              canManage={canManage}
              onResolve={(id) => resolveMutation.mutate(id)}
              isResolving={resolveMutation.isPending}
            />
          )}
        </div>
      )}
    </section>
  );
}
