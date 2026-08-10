import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// Mirrors backend/app/settings/schemas.py. Todo campo es opcional en la
// escritura: sólo se tocan las claves que se envían (ver
// app.settings.service.update_settings) — una cadena vacía borra el
// override y vuelve al valor de entorno; omitir la clave la deja igual.

export const systemSettingsSchema = z.object({
  smtp_host: z.string(),
  smtp_port: z.number(),
  smtp_use_tls: z.boolean(),
  smtp_username: z.string().nullable(),
  smtp_password_set: z.boolean(),
  smtp_from_email: z.string(),
  notification_recipient_email: z.string().nullable(),
  updated_at: z.string().nullable(),
});
export type SystemSettings = z.infer<typeof systemSettingsSchema>;

export interface SystemSettingsUpdate {
  smtp_host?: string;
  smtp_port?: number;
  smtp_use_tls?: boolean;
  smtp_username?: string;
  smtp_password?: string;
  smtp_from_email?: string;
  notification_recipient_email?: string;
}

export interface SmtpTestPayload extends SystemSettingsUpdate {
  to_email: string;
}

export const smtpSettingsQuery = queryOptions({
  queryKey: ['settings', 'smtp'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/settings/smtp`, { schema: systemSettingsSchema, signal }),
});

export async function updateSmtpSettings(payload: SystemSettingsUpdate): Promise<SystemSettings> {
  return apiFetch(`${API_V1}/settings/smtp`, {
    method: 'PUT',
    schema: systemSettingsSchema,
    body: payload,
  });
}

export async function testSmtpSettings(payload: SmtpTestPayload): Promise<void> {
  await apiFetch(`${API_V1}/settings/smtp/test`, {
    method: 'POST',
    schema: z.null(),
    body: payload,
  });
}
