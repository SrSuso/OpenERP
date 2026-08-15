import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { pricingSettingsQuery } from '@/features/pricing/api';
import { TemplateFieldsForm } from '@/features/tickets/TemplateFieldsForm';
import { TemplateHistoryTable } from '@/features/tickets/TemplateHistoryTable';
import {
  TAX_DISPLAY_LABELS,
  activateTemplate,
  activeTicketTemplateQuery,
  createTemplate,
  deleteTemplate,
  reviseTemplate,
  ticketTemplatesQuery,
  type TemplateFields,
  type TicketTemplate,
} from '@/features/tickets/api';
import { ApiError } from '@/lib/api';

import { primaryAction } from './pageActions';

/** `/admin/ticket-templates` — gated por `ticket.manage`, sin caso de uso
 * desde el TPV (backend/app/tickets/router.py).
 *
 * Se pueden tener varias guardadas y elegir con cuál imprime la caja
 * ("Usar esta"), pero sólo una está en uso a la vez. Editar cualquiera de
 * ellas crea una versión nueva sin tocar la que ya imprimió tickets, y
 * editar una que no está en uso no cambia con cuál se imprime. */
export function TicketTemplatesPage() {
  const [mode, setMode] = useState<'none' | 'create' | 'revise'>('none');
  // Cuál se está editando. Puede ser una que no está en uso: corregir una
  // alternativa guardada no cambia con cuál imprime la caja.
  const [editing, setEditing] = useState<TicketTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = useQuery(activeTicketTemplateQuery);
  const templates = useQuery(ticketTemplatesQuery);
  // Sólo para la vista previa: el desglose se calcula distinto según se
  // extraiga el IVA del precio o se le sume (Precios → PricingSettings).
  const pricing = useQuery(pricingSettingsQuery);
  const pricesIncludeTax = pricing.data?.prices_include_tax ?? false;
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

  const activateMutation = useMutation({
    mutationFn: (template: TicketTemplate) => activateTemplate(template.id),
    onSuccess: () => {
      invalidate();
      setError(null);
    },
    onError: () => setError('No se ha podido cambiar la plantilla en uso.'),
  });

  const reviseMutation = useMutation({
    mutationFn: (payload: TemplateFields) => reviseTemplate(editing!.id, payload),
    onSuccess: () => {
      invalidate();
      setMode('none');
      setEditing(null);
      setError(null);
    },
    onError: () => setError('No se ha podido guardar la nueva versión.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (template: TicketTemplate) => deleteTemplate(template.id),
    onSuccess: () => {
      invalidate();
      setError(null);
    },
    onError: (err: unknown) =>
      setError(
        err instanceof ApiError && err.code === 'conflict'
          ? 'No se puede eliminar una plantilla que ya se utilizó para generar tickets.'
          : 'No se ha podido eliminar la plantilla.',
      ),
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
            IVA en el ticket: {TAX_DISPLAY_LABELS[active.data.tax_display]} · Descuento por línea:{' '}
            {active.data.show_line_discounts ? 'sí' : 'no'}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(active.data);
                setMode('revise');
              }}
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
        <button type="button" onClick={() => setMode('create')} className={`mb-4 ${primaryAction}`}>
          Crear plantilla
        </button>
      )}

      {mode === 'create' && (
        <TemplateFieldsForm
          mode="create"
          pricesIncludeTax={pricesIncludeTax}
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

      {mode === 'revise' && editing && (
        <TemplateFieldsForm
          mode="revise"
          defaults={editing}
          pricesIncludeTax={pricesIncludeTax}
          isPending={reviseMutation.isPending}
          submitError={error}
          onCancel={() => {
            setMode('none');
            setEditing(null);
            setError(null);
          }}
          onSubmit={(payload) => reviseMutation.mutate(payload)}
        />
      )}

      <h2 className="mb-2 mt-6 text-lg font-semibold text-slate-800">Todas las plantillas</h2>
      {templates.data && (
        <TemplateHistoryTable
          templates={templates.data}
          isActivating={activateMutation.isPending}
          isDeleting={deleteMutation.isPending}
          onActivate={(template) => activateMutation.mutate(template)}
          onEdit={(template) => {
            setEditing(template);
            setMode('revise');
          }}
          onDelete={(template) => {
            const activeWarning = template.is_active
              ? ' La caja se quedará sin plantilla activa hasta que crees o actives otra.'
              : '';
            if (
              window.confirm(
                `¿Eliminar la plantilla “${template.name}” v${template.version}?${activeWarning}`,
              )
            ) {
              deleteMutation.mutate(template);
            }
          }}
        />
      )}
    </section>
  );
}
