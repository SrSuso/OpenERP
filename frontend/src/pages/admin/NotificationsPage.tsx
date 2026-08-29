import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/features/auth/useAuth';
import { CreateRuleForm } from '@/features/notifications/CreateRuleForm';
import { IncidentsTable } from '@/features/notifications/IncidentsTable';
import { RulesTable } from '@/features/notifications/RulesTable';
import {
  createRule,
  deleteRule,
  evaluateRules,
  incidentsQuery,
  notificationRulesQuery,
  resolveIncident,
  updateRule,
  type Incident,
  type NotificationRule,
  type RuleCreateInput,
} from '@/features/notifications/api';

import { primaryAction, secondaryAction } from './pageActions';

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

  const [tab, setTab] = useState<'rules' | 'incidents'>('incidents');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingRule, setEditingRule] = useState<NotificationRule | null>(null);
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
      setEditingRule(null);
      setCreateError(null);
    },
    onError: () => setCreateError('No se ha podido crear la regla.'),
  });

  const toggleMutation = useMutation({
    mutationFn: (rule: NotificationRule) => updateRule(rule.id, { is_active: !rule.is_active }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: notificationRulesQuery.queryKey }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ rule, payload }: { rule: NotificationRule; payload: RuleCreateInput }) =>
      updateRule(rule.id, {
        name: payload.name,
        params: payload.params,
        severity: payload.severity,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationRulesQuery.queryKey });
      setShowCreateForm(false);
      setEditingRule(null);
      setCreateError(null);
    },
    onError: () => setCreateError('No se han podido guardar los cambios de la regla.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (rule: NotificationRule) => deleteRule(rule.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationRulesQuery.queryKey });
      void queryClient.invalidateQueries({ queryKey: ['notifications', 'incidents'] });
      setShowCreateForm(false);
      setEditingRule(null);
      setCreateError(null);
    },
    onError: () => setCreateError('No se ha podido eliminar la regla.'),
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
    <section className="space-y-5">
      <header className="rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-5 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Avisos</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Consulta las incidencias que requieren atención y define las reglas que las generan.
        </p>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <nav className="flex gap-2 border-b border-slate-200 px-4" aria-label="Avisos">
          <button
            type="button"
            onClick={() => setTab('incidents')}
            className={tabClassName(tab === 'incidents')}
          >
            Incidencias
          </button>
          <button
            type="button"
            onClick={() => setTab('rules')}
            className={tabClassName(tab === 'rules')}
          >
            Reglas
          </button>
        </nav>

        {tab === 'rules' && (
          <div className="p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-800">Reglas de aviso</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Activa sólo los controles que aporten valor a tu operativa.
                </p>
              </div>
              {canManage && !showCreateForm && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingRule(null);
                    setCreateError(null);
                    setShowCreateForm(true);
                  }}
                  className={primaryAction}
                >
                  Nueva regla
                </button>
              )}
            </div>

            {showCreateForm && (
              <CreateRuleForm
                key={editingRule?.id ?? 'new'}
                {...(editingRule ? { rule: editingRule } : {})}
                isPending={createMutation.isPending || updateMutation.isPending}
                submitError={createError}
                onCancel={() => {
                  setShowCreateForm(false);
                  setEditingRule(null);
                  setCreateError(null);
                }}
                onSubmit={(payload) => {
                  if (editingRule) {
                    updateMutation.mutate({ rule: editingRule, payload });
                    return;
                  }
                  createMutation.mutate(payload);
                }}
              />
            )}

            {rules.data && (
              <RulesTable
                rules={rules.data}
                canManage={canManage}
                onEdit={(rule) => {
                  setEditingRule(rule);
                  setCreateError(null);
                  setShowCreateForm(true);
                }}
                onDelete={(rule) => {
                  if (
                    window.confirm(
                      `¿Eliminar la regla «${rule.name}»?\n\nTambién se eliminarán las incidencias generadas por ella. Esta acción no se puede deshacer.`,
                    )
                  ) {
                    deleteMutation.mutate(rule);
                  }
                }}
                onToggleActive={(rule) => toggleMutation.mutate(rule)}
                isMutating={
                  toggleMutation.isPending || updateMutation.isPending || deleteMutation.isPending
                }
              />
            )}
          </div>
        )}

        {tab === 'incidents' && (
          <div className="p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-800">Incidencias</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Revisa primero las abiertas y márcalas como resueltas cuando estén atendidas.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
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
                    className={secondaryAction}
                  >
                    {evaluateMutation.isPending ? 'Evaluando…' : 'Evaluar ahora'}
                  </button>
                )}
              </div>
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
      </div>
    </section>
  );
}
