import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { TemplateFieldsForm } from '@/features/tickets/TemplateFieldsForm';
import { TemplateHistoryTable } from '@/features/tickets/TemplateHistoryTable';
import {
  activeTicketTemplateQuery,
  createTemplate,
  reviseTemplate,
  ticketTemplatesQuery,
  type TemplateFields,
} from '@/features/tickets/api';
import { ApiError } from '@/lib/api';

/** `/admin/ticket-templates` — gated por `ticket.manage`, sin caso de uso
 * desde el TPV (backend/app/tickets/router.py). Sólo hay una plantilla
 * activa en toda la tienda a la vez; "revisar" crea una versión nueva sin
 * tocar la que ya imprimió tickets. */
export function TicketTemplatesPage() {
  const [mode, setMode] = useState<'none' | 'create' | 'revise'>('none');
  const [error, setError] = useState<string | null>(null);

  const active = useQuery(activeTicketTemplateQuery);
  const templates = useQuery(ticketTemplatesQuery);
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['tickets', 'templates'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: TemplateFields & { name: string }) => createTemplate(payload),
    onSuccess: () => {
      invalidate();
      setMode('none');
      setError(null);
    },
    onError: (err: unknown) =>
      setError(
        err instanceof ApiError && err.code === 'conflict'
          ? 'Ya existe una plantilla con ese nombre.'
          : 'No se ha podido crear la plantilla.',
      ),
  });

  const reviseMutation = useMutation({
    mutationFn: (payload: TemplateFields) => reviseTemplate(active.data!.id, payload),
    onSuccess: () => {
      invalidate();
      setMode('none');
      setError(null);
    },
    onError: () => setError('No se ha podido guardar la nueva versión.'),
  });

  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">Plantillas de ticket</h1>

      {active.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {active.isError && (
        <p className="mb-4 text-sm text-slate-500">Todavía no hay ninguna plantilla activa.</p>
      )}

      {active.data && mode === 'none' && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-700">
            Activa: {active.data.name} · v{active.data.version} · {active.data.width_mm} mm
          </p>
          <pre className="mt-2 max-w-xs whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-600">
            {active.data.header_text || '(sin cabecera)'}
            {'\n…\n'}
            {active.data.footer_text || '(sin pie)'}
          </pre>
          <p className="mt-1 text-xs text-slate-500">
            Desglose de impuestos: {active.data.show_tax_breakdown ? 'sí' : 'no'}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setMode('revise')}
              className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
            >
              Revisar
            </button>
            <button
              type="button"
              onClick={() => setMode('create')}
              className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Nueva plantilla (otro nombre)
            </button>
          </div>
        </div>
      )}

      {active.isError && mode === 'none' && (
        <button
          type="button"
          onClick={() => setMode('create')}
          className="mb-4 rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          Crear plantilla
        </button>
      )}

      {mode === 'create' && (
        <TemplateFieldsForm
          mode="create"
          isPending={createMutation.isPending}
          submitError={error}
          onCancel={() => {
            setMode('none');
            setError(null);
          }}
          onSubmit={(payload) =>
            createMutation.mutate(payload as TemplateFields & { name: string })
          }
        />
      )}

      {mode === 'revise' && active.data && (
        <TemplateFieldsForm
          mode="revise"
          defaults={active.data}
          isPending={reviseMutation.isPending}
          submitError={error}
          onCancel={() => {
            setMode('none');
            setError(null);
          }}
          onSubmit={(payload) => reviseMutation.mutate(payload)}
        />
      )}

      <h2 className="mb-2 mt-6 text-lg font-semibold text-slate-800">Historial de versiones</h2>
      {templates.data && <TemplateHistoryTable templates={templates.data} />}
    </section>
  );
}
