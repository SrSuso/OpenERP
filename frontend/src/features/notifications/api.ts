import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// Mirrors backend/app/notifications/rules.py's RuleType whitelist — un
// tipo de regla sólo puede apuntar a uno de estos detectores, nunca a SQL
// arbitrario desde el panel.
export const RULE_TYPES = ['LOW_STOCK', 'EXPIRING_LOT'] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export const notificationRuleSchema = z.object({
  id: z.number(),
  name: z.string(),
  rule_type: z.enum(RULE_TYPES),
  params: z.record(z.unknown()),
  is_active: z.boolean(),
});
export type NotificationRule = z.infer<typeof notificationRuleSchema>;

export const notificationRulesQuery = queryOptions({
  queryKey: ['notifications', 'rules'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/notification-rules`, {
      schema: z.array(notificationRuleSchema),
      signal,
    }),
});

export interface RuleCreateInput {
  name: string;
  rule_type: RuleType;
  params: Record<string, unknown>;
}

export async function createRule(payload: RuleCreateInput): Promise<NotificationRule> {
  return apiFetch(`${API_V1}/notification-rules`, {
    method: 'POST',
    schema: notificationRuleSchema,
    body: payload,
  });
}

export interface RuleUpdateInput {
  name?: string;
  params?: Record<string, unknown>;
  is_active?: boolean;
}

export async function updateRule(id: number, payload: RuleUpdateInput): Promise<NotificationRule> {
  return apiFetch(`${API_V1}/notification-rules/${id}`, {
    method: 'PATCH',
    schema: notificationRuleSchema,
    body: payload,
  });
}

// --- incidencias -------------------------------------------------------

export const incidentSchema = z.object({
  id: z.number(),
  rule_id: z.number(),
  rule_name: z.string(),
  subject_type: z.string(),
  subject_id: z.number(),
  message: z.string(),
  status: z.string(),
  first_detected_at: z.string(),
  last_seen_at: z.string(),
  resolved_at: z.string().nullable(),
});
export type Incident = z.infer<typeof incidentSchema>;

export function incidentsQuery(filters: { status?: string; ruleId?: number }) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.ruleId !== undefined) params.set('rule_id', String(filters.ruleId));

  return queryOptions({
    queryKey: ['notifications', 'incidents', filters] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/incidents?${params.toString()}`, {
        schema: z.array(incidentSchema),
        signal,
      }),
  });
}

export async function evaluateRules(): Promise<Incident[]> {
  return apiFetch(`${API_V1}/notifications/evaluate`, {
    method: 'POST',
    schema: z.array(incidentSchema),
  });
}

export async function resolveIncident(id: number): Promise<Incident> {
  return apiFetch(`${API_V1}/incidents/${id}/resolve`, {
    method: 'POST',
    schema: incidentSchema,
  });
}
