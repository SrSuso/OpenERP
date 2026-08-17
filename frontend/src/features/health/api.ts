import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { meSchema } from '@/features/auth/api';
import { API_V1, apiFetch } from '@/lib/api';

export const healthSchema = z.object({
  status: z.literal('ok'),
  app: z.string(),
  environment: z.string(),
});

export type Health = z.infer<typeof healthSchema>;

export const healthQuery = queryOptions({
  queryKey: ['health', 'live'] as const,
  // `/health/live` queda deliberadamente fuera del perímetro público. El
  // panel sólo existe dentro de una sesión de administración, así que
  // `/auth/me` comprueba a la vez que nginx alcanza la API y que la sesión
  // sigue siendo válida, sin exponer una sonda interna a la red.
  queryFn: async ({ signal }) => {
    await apiFetch(`${API_V1}/auth/me`, {
      schema: meSchema,
      signal,
      headers: { 'X-OpenERP-Session-Surface': 'admin' },
    });
    return healthSchema.parse({ status: 'ok', app: 'OpenERP', environment: 'sesión autenticada' });
  },
});
