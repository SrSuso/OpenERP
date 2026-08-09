import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// Mirrors backend/app/jobs/schemas.py. El envío real lo hace
// app.jobs.worker (proceso aparte, rule 10: SMTP nunca bloquea una
// venta) — esta pantalla es sólo observabilidad + un disparo manual.
export const outboxMessageSchema = z.object({
  id: z.number(),
  to_email: z.string(),
  subject: z.string(),
  body_text: z.string(),
  status: z.string(),
  attempts: z.number(),
  last_error: z.string().nullable(),
  sent_at: z.string().nullable(),
  reference_type: z.string().nullable(),
  reference_id: z.number().nullable(),
  created_at: z.string(),
});
export type OutboxMessage = z.infer<typeof outboxMessageSchema>;

export function outboxQuery(status: string) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);

  return queryOptions({
    queryKey: ['outbox', 'list', status] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/outbox?${params.toString()}`, {
        schema: z.array(outboxMessageSchema),
        signal,
      }),
  });
}

export async function runOutbox(): Promise<number> {
  const result = await apiFetch(`${API_V1}/outbox/run`, {
    method: 'POST',
    schema: z.object({ processed: z.number() }),
  });
  return result.processed;
}
