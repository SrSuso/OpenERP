import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// Mirrors backend/app/tickets/schemas.py. Sólo hay una plantilla activa a
// la vez en toda la tienda (app.tickets.service's docstring) — revisarla
// crea una nueva versión bajo el mismo nombre, nunca muta la anterior.

export const ticketTemplateSchema = z.object({
  id: z.number(),
  name: z.string(),
  version: z.number(),
  width_mm: z.union([z.literal(58), z.literal(80)]),
  header_text: z.string(),
  footer_text: z.string(),
  show_tax_breakdown: z.boolean(),
  is_active: z.boolean(),
});
export type TicketTemplate = z.infer<typeof ticketTemplateSchema>;

export const ticketTemplatesQuery = queryOptions({
  queryKey: ['tickets', 'templates'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/ticket-templates`, { schema: z.array(ticketTemplateSchema), signal }),
});

export const activeTicketTemplateQuery = queryOptions({
  queryKey: ['tickets', 'templates', 'active'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/ticket-templates/active`, { schema: ticketTemplateSchema, signal }),
});

export interface TemplateFields {
  width_mm: 58 | 80;
  header_text: string;
  footer_text: string;
  show_tax_breakdown: boolean;
}

export async function createTemplate(
  payload: TemplateFields & { name: string },
): Promise<TicketTemplate> {
  return apiFetch(`${API_V1}/ticket-templates`, {
    method: 'POST',
    schema: ticketTemplateSchema,
    body: payload,
  });
}

export async function reviseTemplate(
  templateId: number,
  payload: TemplateFields,
): Promise<TicketTemplate> {
  return apiFetch(`${API_V1}/ticket-templates/${templateId}/revise`, {
    method: 'POST',
    schema: ticketTemplateSchema,
    body: payload,
  });
}
