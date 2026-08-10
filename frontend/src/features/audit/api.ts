import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// Mirrors backend/app/audit/schemas.py's AuditLogRead. Sólo lectura — el
// registro es de sólo-anexado desde app.audit.service, no hay endpoints de
// escritura que exponer aquí (ver ese módulo).

export const auditLogEntrySchema = z.object({
  id: z.number(),
  user_id: z.number().nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.number().nullable(),
  before_data: z.record(z.string(), z.unknown()).nullable(),
  after_data: z.record(z.string(), z.unknown()).nullable(),
  request_id: z.string().nullable(),
  ip: z.string().nullable(),
  created_at: z.string(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export interface AuditLogFilters {
  entityType?: string;
  entityId?: number;
  userId?: number;
  limit: number;
  offset: number;
}

export function auditLogQuery(filters: AuditLogFilters) {
  const params = new URLSearchParams();
  if (filters.entityType) params.set('entity_type', filters.entityType);
  if (filters.entityId !== undefined) params.set('entity_id', String(filters.entityId));
  if (filters.userId !== undefined) params.set('user_id', String(filters.userId));
  params.set('limit', String(filters.limit));
  params.set('offset', String(filters.offset));

  return queryOptions({
    queryKey: ['audit', 'log', filters] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/audit-log?${params.toString()}`, {
        schema: z.array(auditLogEntrySchema),
        signal,
      }),
  });
}
