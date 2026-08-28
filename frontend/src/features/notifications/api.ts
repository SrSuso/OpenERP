import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

export const activeAlertSchema = z.object({
  id: z.number(),
  kind: z.enum(['LOW_STOCK', 'EXPIRATION']),
  title: z.string(),
  product_id: z.number(),
  stock_current: z.string().nullable(),
  min_stock: z.string().nullable(),
  replenish: z.string().nullable(),
  lot_id: z.number().nullable(),
  lot_number: z.string().nullable(),
  expiration_date: z.string().nullable(),
  days_remaining: z.number().nullable(),
  quantity_remaining: z.string().nullable(),
});
export type ActiveAlert = z.infer<typeof activeAlertSchema>;

export const activeAlertsQuery = queryOptions({
  queryKey: ['notifications', 'alerts', 'active'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/alerts`, { schema: z.array(activeAlertSchema), signal }),
  refetchInterval: 60_000,
});

const stockGeneralSchema = z.object({
  enabled: z.boolean(),
  min_stock: z.string(),
});

const expirationGeneralSchema = z.object({
  enabled: z.boolean(),
  days_before_expiration: z.number(),
});

const productExpirationSchema = z.object({
  product_id: z.number(),
  product_name: z.string(),
  days_before_expiration: z.number(),
});

export const notificationSettingsSchema = z.object({
  stock_general: stockGeneralSchema,
  general_expiration: expirationGeneralSchema,
  product_expirations: z.array(productExpirationSchema),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const notificationSettingsQuery = queryOptions({
  queryKey: ['notifications', 'settings'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/notification-settings`, {
      schema: notificationSettingsSchema,
      signal,
    }),
});

export async function updateGeneralStock(payload: {
  enabled: boolean;
  min_stock: string;
}): Promise<NotificationSettings> {
  return apiFetch(`${API_V1}/notification-settings/stock`, {
    method: 'PUT',
    schema: notificationSettingsSchema,
    body: payload,
  });
}

export async function updateGeneralExpiration(payload: {
  enabled: boolean;
  days_before_expiration: number;
}): Promise<NotificationSettings> {
  return apiFetch(`${API_V1}/notification-settings/expiration/general`, {
    method: 'PUT',
    schema: notificationSettingsSchema,
    body: payload,
  });
}

export async function updateProductExpiration(
  productId: number,
  daysBeforeExpiration: number,
): Promise<NotificationSettings> {
  return apiFetch(`${API_V1}/notification-settings/expiration/products/${productId}`, {
    method: 'PUT',
    schema: notificationSettingsSchema,
    body: { days_before_expiration: daysBeforeExpiration },
  });
}

export async function removeProductExpiration(productId: number): Promise<NotificationSettings> {
  return apiFetch(`${API_V1}/notification-settings/expiration/products/${productId}`, {
    method: 'DELETE',
    schema: notificationSettingsSchema,
  });
}
