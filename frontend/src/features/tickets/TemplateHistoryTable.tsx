import { type TicketTemplate } from '@/features/tickets/api';

export function TemplateHistoryTable({ templates }: { templates: TicketTemplate[] }) {
  if (templates.length === 0) {
    return <p className="text-sm text-slate-500">Todavía no hay ninguna plantilla.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Nombre</th>
            <th className="px-4 py-2 font-medium">Versión</th>
            <th className="px-4 py-2 font-medium">Ancho</th>
            <th className="px-4 py-2 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((template) => (
            <tr key={template.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2 font-medium text-slate-800">{template.name}</td>
              <td className="px-4 py-2">v{template.version}</td>
              <td className="px-4 py-2">{template.width_mm} mm</td>
              <td className="px-4 py-2">
                {template.is_active ? (
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                    Activa
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                    Retirada
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
