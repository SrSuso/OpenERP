import { type TicketTemplate } from '@/features/tickets/api';

interface TemplateHistoryTableProps {
  templates: TicketTemplate[];
  /** Poner en uso la plantilla de esa fila, o editarla sin ponerla en uso. */
  onActivate: (template: TicketTemplate) => void;
  onEdit: (template: TicketTemplate) => void;
  onDelete: (template: TicketTemplate) => void;
  isActivating: boolean;
  isDeleting: boolean;
}

export function TemplateHistoryTable({
  templates,
  onActivate,
  onEdit,
  onDelete,
  isActivating,
  isDeleting,
}: TemplateHistoryTableProps) {
  if (templates.length === 0) {
    return <p className="text-sm text-slate-500">Todavía no hay ninguna plantilla.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Nombre</th>
            <th className="px-4 py-2 font-medium">Ancho imprimible</th>
            <th className="px-4 py-2 font-medium">Estado</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {templates.map((template) => (
            <tr key={template.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2 font-medium text-slate-800">{template.name}</td>
              <td className="px-4 py-2">{template.printable_width_mm} mm</td>
              <td className="px-4 py-2">
                {template.is_active ? (
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                    Activa
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                    Guardada
                  </span>
                )}
              </td>
              <td className="px-4 py-2 text-right">
                <span className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => onEdit(template)}
                    className="text-xs font-medium text-brand-700 hover:underline"
                  >
                    Editar
                  </button>
                  {!template.is_active && (
                    <button
                      type="button"
                      disabled={isActivating}
                      onClick={() => onActivate(template)}
                      className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50"
                    >
                      Usar esta
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => onDelete(template)}
                    className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                  >
                    Eliminar
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
