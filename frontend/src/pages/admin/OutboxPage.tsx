import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/features/auth/AuthContext';
import { OutboxTable } from '@/features/outbox/OutboxTable';
import { outboxQuery, runOutbox } from '@/features/outbox/api';

import { pageHeaderRow, secondaryAction } from './pageActions';

/** `/admin/outbox` — gated by `job.read`; disparar un lote manual necesita
 * `job.manage`. El envío real de verdad lo hace `app.jobs.worker`, un
 * proceso aparte con su propio cadencia — esto es sólo observabilidad y
 * un botón de depuración (rule 10: SMTP nunca bloquea una venta). */
export function OutboxPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('job.manage');

  const [status, setStatus] = useState('');
  const [runResult, setRunResult] = useState<number | null>(null);

  const messages = useQuery(outboxQuery(status));
  const queryClient = useQueryClient();

  const runMutation = useMutation({
    mutationFn: () => runOutbox(),
    onSuccess: (processed) => {
      setRunResult(processed);
      void queryClient.invalidateQueries({ queryKey: ['outbox', 'list'] });
    },
  });

  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">Outbox / correo</h1>

      <div className={pageHeaderRow}>
        <label className="text-sm text-slate-600">
          Estado
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="mt-1 block rounded border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="">Todos</option>
            <option value="PENDING">Pendientes</option>
            <option value="SENT">Enviados</option>
            <option value="FAILED">Fallidos</option>
          </select>
        </label>

        {canManage && (
          <div className="flex items-center gap-2">
            {runResult !== null && (
              <span className="text-sm text-slate-500">
                Último lote: {runResult} mensaje{runResult === 1 ? '' : 's'} procesado
                {runResult === 1 ? '' : 's'}.
              </span>
            )}
            <button
              type="button"
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              className={secondaryAction}
            >
              {runMutation.isPending ? 'Procesando…' : 'Procesar ahora'}
            </button>
          </div>
        )}
      </div>

      {messages.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {messages.isError && (
        <p className="text-sm text-red-600">No se han podido cargar los mensajes.</p>
      )}
      {messages.data && <OutboxTable messages={messages.data} />}
    </section>
  );
}
