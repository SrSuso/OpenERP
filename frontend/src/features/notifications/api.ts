import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// Mirrors backend/app/notifications/rules.py's RuleType whitelist — un
// tipo de regla sólo puede apuntar a uno de estos detectores, nunca a SQL
// arbitrario desde el panel.
export const RULE_TYPES = ['LOW_STOCK', 'EXPIRING_LOT', 'CONDITION'] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export const SEVERITIES = ['LOW', 'MEDIUM_LOW', 'MEDIUM_HIGH', 'HIGH'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABELS: Record<Severity, string> = {
  LOW: 'Bajo',
  MEDIUM_LOW: 'Medio-bajo',
  MEDIUM_HIGH: 'Medio-alto',
  HIGH: 'Alto',
};

/** Color por criticidad, y si parpadea. Sólo los dos altos parpadean: si
 * lo hiciera todo, dejaría de llamar la atención nada. */
export const SEVERITY_STYLES: Record<Severity, { badge: string; blink: boolean }> = {
  LOW: { badge: 'bg-slate-100 text-slate-600', blink: false },
  MEDIUM_LOW: { badge: 'bg-sky-100 text-sky-800', blink: false },
  MEDIUM_HIGH: { badge: 'bg-amber-100 text-amber-900', blink: true },
  HIGH: { badge: 'bg-red-100 text-red-800', blink: true },
};

export const notificationRuleSchema = z.object({
  id: z.number(),
  name: z.string(),
  rule_type: z.enum(RULE_TYPES),
  params: z.record(z.string(), z.unknown()),
  severity: z.enum(SEVERITIES),
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
  severity: Severity;
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
  severity?: Severity;
  is_active?: boolean;
}

export async function updateRule(id: number, payload: RuleUpdateInput): Promise<NotificationRule> {
  return apiFetch(`${API_V1}/notification-rules/${id}`, {
    method: 'PATCH',
    schema: notificationRuleSchema,
    body: payload,
  });
}

export async function deleteRule(id: number): Promise<void> {
  await apiFetch(`${API_V1}/notification-rules/${id}`, {
    method: 'DELETE',
    schema: z.null(),
  });
}

// --- incidencias -------------------------------------------------------

export const incidentSchema = z.object({
  id: z.number(),
  rule_id: z.number(),
  rule_name: z.string(),
  severity: z.enum(SEVERITIES),
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

// --- catálogo del constructor de reglas --------------------------------

/** Lo que se puede consultar y con qué comparadores, servido por el
 * backend (`GET /notification-fields`) — el panel no lleva escrita ni una
 * clave de campo, así que añadir uno nuevo allí aparece aquí solo. */
export const conditionCatalogueSchema = z.object({
  subjects: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      fields: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          type: z.enum(['NUMBER', 'DAYS']),
          help: z.string(),
        }),
      ),
    }),
  ),
  operators: z.array(z.string()),
  severities: z.array(z.string()),
});
export type ConditionCatalogue = z.infer<typeof conditionCatalogueSchema>;

export const conditionCatalogueQuery = queryOptions({
  queryKey: ['notifications', 'fields'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/notification-fields`, { schema: conditionCatalogueSchema, signal }),
});
