import { Fragment, useState } from 'react';

import { type OutboxMessage } from '@/features/outbox/api';

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  SENT: 'bg-green-50 text-green-700',
  FAILED: 'bg-red-50 text-red-600',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendiente',
  SENT: 'Enviado',
  FAILED: 'Fallido',
};

export function OutboxTable({ messages }: { messages: OutboxMessage[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (messages.length === 0) {
    return <p className="text-sm text-slate-500">No hay mensajes con estos filtros.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Fecha</th>
            <th className="px-4 py-2 font-medium">Para</th>
            <th className="px-4 py-2 font-medium">Asunto</th>
            <th className="px-4 py-2 font-medium">Intentos</th>
            <th className="px-4 py-2 font-medium">Estado</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {messages.map((message) => (
            <Fragment key={message.id}>
              <tr className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2 text-xs text-slate-500">
                  {new Date(message.created_at).toLocaleString('es-ES')}
                </td>
                <td className="px-4 py-2">{message.to_email}</td>
                <td className="px-4 py-2">{message.subject}</td>
                <td className="px-4 py-2">{message.attempts}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[message.status] ?? 'bg-slate-100 text-slate-500'}`}
                  >
                    {STATUS_LABELS[message.status] ?? message.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId((current) => (current === message.id ? null : message.id))
                    }
                    className="text-sm font-medium text-slate-600 hover:underline"
                  >
                    {expandedId === message.id ? 'Ocultar' : 'Ver'}
                  </button>
                </td>
              </tr>
              {expandedId === message.id && (
                <tr>
                  <td colSpan={6} className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                    <pre className="whitespace-pre-wrap text-xs text-slate-700">
                      {message.body_text}
                    </pre>
                    {message.last_error && (
                      <p className="mt-2 text-xs text-red-600">
                        Último error: {message.last_error}
                      </p>
                    )}
                    {message.reference_type && (
                      <p className="mt-1 text-xs text-slate-400">
                        Origen: {message.reference_type} #{message.reference_id}
                      </p>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
