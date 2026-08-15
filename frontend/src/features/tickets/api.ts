import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// Mirrors backend/app/tickets/schemas.py. Sólo hay una plantilla activa a
// la vez en toda la tienda (app.tickets.service's docstring) — revisarla
// crea una nueva versión bajo el mismo nombre, nunca muta la anterior.

/** Cómo indica el ticket el IVA que lleva dentro — ver
 * backend/app/tickets/models.py's `TicketTaxDisplay`. Una factura
 * simplificada española necesita al menos `NOTE`; `NONE` sólo vale para
 * un recibo interno. */
export const ticketTaxDisplaySchema = z.enum(['NONE', 'NOTE', 'BREAKDOWN']);
export type TicketTaxDisplay = z.infer<typeof ticketTaxDisplaySchema>;

export const TAX_DISPLAY_LABELS: Record<TicketTaxDisplay, string> = {
  NONE: 'No indicar nada',
  NOTE: 'Sólo la nota «IVA incluido»',
  BREAKDOWN: 'Desglose por tipo (base y cuota)',
};

export const ticketTemplateSchema = z.object({
  id: z.number(),
  name: z.string(),
  version: z.number(),
  width_mm: z.union([z.literal(58), z.literal(80)]),
  header_text: z.string(),
  footer_text: z.string(),
  tax_display: ticketTaxDisplaySchema,
  show_line_discounts: z.boolean(),
  // Lo que antes vivía en Configuración: el ticket se edita en un solo
  // sitio, su plantilla (backend/app/tickets/models.py).
  store_name: z.string(),
  store_tax_id: z.string(),
  store_address: z.string(),
  store_phone: z.string(),
  sale_number_prefix: z.string(),
  date_format: z.string(),
  show_unit_price: z.boolean(),
  show_cashier: z.boolean(),
  label_total: z.string(),
  label_change: z.string(),
  label_cash: z.string(),
  label_card: z.string(),
  label_other: z.string(),
  label_discount: z.string(),
  tax_note: z.string(),
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
  tax_display: TicketTaxDisplay;
  show_line_discounts: boolean;
  store_name: string;
  store_tax_id: string;
  store_address: string;
  store_phone: string;
  sale_number_prefix: string;
  date_format: string;
  show_unit_price: boolean;
  show_cashier: boolean;
  label_total: string;
  label_change: string;
  label_cash: string;
  label_card: string;
  label_other: string;
  label_discount: string;
  tax_note: string;
}

/** Los formatos de fecha que se ofrecen, con cómo se ven — que es lo único
 * que le importa a quien elige. */
export const DATE_FORMATS: { value: string; label: string }[] = [
  { value: '%d/%m/%Y %H:%M', label: '31/12/2026 14:05' },
  { value: '%d-%m-%Y %H:%M', label: '31-12-2026 14:05' },
  { value: '%Y-%m-%d %H:%M', label: '2026-12-31 14:05' },
  { value: '%d/%m/%Y', label: '31/12/2026 (sin hora)' },
];

export async function createTemplate(
  payload: TemplateFields & { name: string },
): Promise<TicketTemplate> {
  return apiFetch(`${API_V1}/ticket-templates`, {
    method: 'POST',
    schema: ticketTemplateSchema,
    body: payload,
  });
}

/** Pone una plantilla guardada en uso. Sigue habiendo exactamente una
 * activa: activar una retira la anterior, que se queda para poder volver.
 * Ver backend/app/tickets/service.py's `activate_template`. */
export async function activateTemplate(templateId: number): Promise<TicketTemplate> {
  return apiFetch(`${API_V1}/ticket-templates/${templateId}/activate`, {
    method: 'POST',
    schema: ticketTemplateSchema,
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

export async function deleteTemplate(templateId: number): Promise<void> {
  await apiFetch(`${API_V1}/ticket-templates/${templateId}`, {
    method: 'DELETE',
    schema: z.null(),
  });
}
